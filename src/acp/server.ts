// ACP Server — stdin/stdout JSON-RPC 2.0 dispatcher
// Reference: math-modeling-agent/src/acp_impl/server.py

import { ACP } from "./protocol"
import { writeACP, readStdin } from "./stdio"
import type { ProviderMeta } from "../provider/provider"
import { Boot } from "../boot"
import { MCP } from "../mcp"
import { Instance } from "../project/instance"
import { decodeToolOutput, projectStructuredToolPayload } from "./builtin-tools"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageV2 } from "../session/message-v2"
import { Bus } from "../bus"
import { ACPProviderMeta } from "./provider-meta"
import { MessageID, type SessionID } from "../session/schema"
import { WorkspaceDiffer } from "./workspace-diff"
import path from "path"
import { Todo } from "../session/todo"
import { todoToPlanEntries } from "./plan"

const PROTOCOL_VERSION = "0.1.0"

function normalizeEmittedPath(pathValue: string, workspace?: string) {
  const originalNormalized = pathValue.replace(/\\+/g, "/")
  const normalized = path.resolve(workspace || process.cwd(), pathValue).replace(/\\+/g, "/")
  return /^[A-Z]:/i.test(originalNormalized) ? normalized.toLowerCase() : normalized
}

interface SessionState {
  id: string
  workspace: string
  mcpServers: MCPServerConfig[]
  abortController?: AbortController
}

interface SessionTurn {
  abortController: AbortController
}

export interface MCPServerConfig {
  type: string
  name: string
  url: string
  headers?: Array<{ name: string; value: string }>
}

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

type PromptInputPart =
  | { type: "text"; text: string }
  | { type: "file"; url: string; filename: string; mime: string }

type PromptInvocation =
  | {
      type: "prompt"
      parts: PromptInputPart[]
    }
  | {
      type: "command"
      command: string
      arguments: string
    }

export class ACPServer {
  private sessions = new Map<string, SessionState>()

  /** Optional hook for tests to capture notifications */
  onNotification?: (msg: unknown) => void

  private _notify(msg: unknown) {
    if (this.onNotification) {
      this.onNotification(msg)
    }
    writeACP(msg as object)
  }

  private claimTurn(session: SessionState): SessionTurn {
    const turn = {
      abortController: new AbortController(),
    }
    session.abortController = turn.abortController
    return turn
  }

  private releaseTurn(session: SessionState, turn: SessionTurn) {
    if (session.abortController === turn.abortController) {
      session.abortController = undefined
    }
  }

  /** Dispatch a JSON-RPC request to the appropriate handler */
  async dispatch(request: JsonRpcRequest): Promise<any> {
    const { id, method, params } = request

    try {
      switch (method) {
        case "initialize":
          return ACP.response(id!, this.handleInitialize())
        case "authenticate":
          return ACP.response(id!, this.handleAuthenticate())
        case "session/new":
          return ACP.response(id!, await this.handleSessionNew(params || {}))
        case "session/load":
          return ACP.response(id!, await this.handleSessionLoad(params || {}))
        case "session/prompt":
          return ACP.response(id!, await this.handleSessionPrompt(params || {}, id!))
        case "session/cancel":
          return ACP.response(id!, await this.handleSessionCancel(params || {}))
        default:
          return ACP.error(id ?? null, -32601, `Method not found: ${method}`)
      }
    } catch (err: any) {
      console.error(`[acp] error handling ${method}:`, err)
      return ACP.error(id ?? null, -32603, err.message || "Internal error")
    }
  }

  // --- Handlers ---

  private handleInitialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        streaming: true,
        tools: true,
        skills: true,
      },
      serverInfo: {
        name: "reaslab-agent",
        version: PROTOCOL_VERSION,
      },
    }
  }

  private handleAuthenticate() {
    // Container-based auth — always authenticated
    return { authenticated: true }
  }

  private async handleSessionNew(params: Record<string, unknown>) {
    const workspace = (params.cwd as string) || "/workspace"
    await Boot.init(workspace)
    const sessionInfo = await Instance.provide({
      directory: workspace,
      fn: () => Session.createNext({ directory: workspace }),
    })
    const session: SessionState = {
      id: sessionInfo.id,
      workspace,
      mcpServers: (params.mcpServers as MCPServerConfig[]) || [],
    }
    this.sessions.set(session.id, session)
    return ACP.sessionBootstrapResult(session.id, session.workspace, [])
  }

  private async handleSessionLoad(params: Record<string, unknown>) {
    const sessionId = params.sessionId as string
    if (!sessionId) throw new Error("sessionId is required")

    let session = this.sessions.get(sessionId)
    let persistedWorkspace = session?.workspace
    if (!session) {
      const workspace = (params.cwd as string) || "/workspace"
      await Boot.init(workspace)
      const dbSession = await Instance.provide({
        directory: workspace,
        fn: () => Session.get(sessionId as SessionID),
      })
      session = {
        id: dbSession.id,
        workspace: dbSession.directory,
        mcpServers: [],
      }
      persistedWorkspace = dbSession.directory
      this.sessions.set(session.id, session)
    }

    persistedWorkspace ||= session.workspace

    const entries = await Instance.provide({
      directory: persistedWorkspace,
      fn: async () => todoToPlanEntries(Todo.get(session.id as SessionID)),
    })

    if (params.cwd) session.workspace = params.cwd as string
    if (params.mcpServers) session.mcpServers = params.mcpServers as MCPServerConfig[]

    return ACP.sessionBootstrapResult(session.id, session.workspace, entries)
  }

  private async handleSessionPrompt(params: Record<string, unknown>, requestId: string | number): Promise<null> {
    const sessionId = params.sessionId as string
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (session.abortController && !session.abortController.signal.aborted) {
      this._notify(ACP.error(requestId, -32603, `Session is busy: ${sessionId}`))
      return null
    }

    const meta = (params._meta || params.meta || {}) as Record<string, unknown>
    const prompt = params.prompt as string | unknown[]
    const invocation = this.resolvePromptInvocation(prompt)

    const providerMeta: ProviderMeta = {
      model: (meta.model as string) || "",
      baseUrl: (meta.baseUrl as string) || "",
      apiKey: (meta.apiKey as string) || "",
      reasoningEffort: meta.reasoningEffort as string | undefined,
      maxTokens: meta.maxTokens as number | undefined,
    }
    if (!providerMeta.model || !providerMeta.baseUrl || !providerMeta.apiKey) {
      throw new Error("_meta must include model, baseUrl, and apiKey")
    }

    const turn = this.claimTurn(session)

    this.executeAgentLoop(session, invocation, providerMeta, requestId)
      .catch((err) => {
        console.error(`[acp] agent loop error for ${sessionId}:`, err)
        if (err instanceof Session.BusyError) {
          this.releaseTurn(session, turn)
          this._notify(ACP.error(requestId, -32603, `Session is busy: ${sessionId}`))
          return
        }
        this._notify(ACP.messageChunk(sessionId, `\n[Agent error: ${err.message}]\n`, { workspace: session.workspace }))
        this._notify(ACP.response(requestId, { stopReason: "error", error: err.message }))
      })
      .finally(() => { this.releaseTurn(session, turn) })

    return null
  }

  private async handleSessionCancel(params: Record<string, unknown>) {
    const sessionId = params.sessionId as string
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (session.abortController) {
      session.abortController.abort()
      session.abortController = undefined
    }
    await Boot.init(session.workspace)
    await Instance.provide({
      directory: session.workspace,
      fn: () => SessionPrompt.cancel(sessionId as SessionID),
    })
    return { cancelled: true }
  }

  // --- Prompt parsing ---

  private resolvePromptInvocation(prompt: string | unknown[]): PromptInvocation {
    if (typeof prompt !== "string") {
      return {
        type: "prompt",
        parts: this.parsePromptToInputParts(prompt),
      }
    }

    if (!prompt.startsWith("/")) {
      return {
        type: "prompt",
        parts: this.parsePromptToInputParts(prompt),
      }
    }

    const newlineIndex = prompt.indexOf("\n")
    const hasMultilineBody = newlineIndex !== -1
    const firstLine = hasMultilineBody ? prompt.slice(0, newlineIndex) : prompt
    const remaining = hasMultilineBody ? prompt.slice(newlineIndex + 1) : ""
    const withoutSlash = firstLine.slice(1)
    const firstWhitespace = withoutSlash.search(/\s/)
    const command = firstWhitespace === -1
      ? withoutSlash
      : withoutSlash.slice(0, firstWhitespace)

    if (!command) {
      throw new Error("Empty slash command")
    }

    const inlineArguments = firstWhitespace === -1
      ? ""
      : withoutSlash.slice(firstWhitespace).trimStart()

    return {
      type: "command",
      command,
      arguments: hasMultilineBody
        ? inlineArguments
          ? `${inlineArguments}\n${remaining}`
          : `\n${remaining}`
        : inlineArguments,
    }
  }

  /** Parse ACP prompt content blocks into SessionPrompt input parts */
  parsePromptToInputParts(prompt: string | unknown[]): PromptInputPart[] {
    if (typeof prompt === "string") return [{ type: "text", text: prompt }]
    if (!Array.isArray(prompt)) return [{ type: "text", text: String(prompt) }]
    return prompt.map((block: any) => {
      if (block.type === "text") return { type: "text" as const, text: block.text }
      if (block.type === "resource") return { type: "text" as const, text: block.resource?.text || "" }
      if (block.type === "resource_link") return { type: "file" as const, url: block.uri, filename: block.name || block.uri, mime: block.mimeType || "text/plain" }
      return { type: "text" as const, text: JSON.stringify(block) }
    })
  }

  // --- Agent loop ---

  private async executeAgentLoop(
    session: SessionState,
    invocation: PromptInvocation,
    providerMeta: ProviderMeta,
    requestId: string | number,
  ): Promise<void> {
    await Boot.init(session.workspace)
    const turnAbortController = session.abortController

    await Instance.provide({
      directory: session.workspace,
      fn: async () => {
        if (session.mcpServers.length > 0) {
          const serverMap: Record<string, { url: string; headers?: Record<string, string> }> = {}
          for (const srv of session.mcpServers) {
            const headers: Record<string, string> = {}
            for (const h of srv.headers || []) { headers[h.name] = h.value }
            serverMap[srv.name] = { url: srv.url, headers }
          }
          await MCP.connectFromACP(serverMap).catch((err: any) => {
            console.error("[acp] MCP connection error:", err.message)
          })
        }

        // Workspace diff safety net: snapshot before agent runs
        const wsDiff = new WorkspaceDiffer()
        await wsDiff.snapshot(session.workspace)

        ACPProviderMeta()[session.id] = providerMeta

        const sessionId = session.id
        const partTypes = new Map<string, string>()
        const emittedDiffPaths = new Set<string>()

        const unsubPartUpdated = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          const part = event.properties.part
          if (part.sessionID !== sessionId) return
          switch (part.type) {
            case "text":
              partTypes.set(part.id, "text")
              break
            case "reasoning":
              partTypes.set(part.id, "reasoning")
              break
            case "tool": {
              if (part.state.status === "running") {
                this._notify(ACP.toolCall(sessionId, part.callID, part.tool, (part.state.input ?? {}) as Record<string, unknown>, session.workspace))
              } else if (part.state.status === "completed") {
                const { output: rawOutput, diff, structured: encodedStructured } = decodeToolOutput(part.state.output)
                const structured = encodedStructured ?? projectStructuredToolPayload(part.tool, part.state.metadata)
                if (diff) emittedDiffPaths.add(normalizeEmittedPath(diff.path, session.workspace))
                this._notify(
                  ACP.toolCallUpdate(
                    sessionId,
                    part.callID,
                    "completed",
                    rawOutput,
                    diff,
                    { workspace: session.workspace },
                    {
                      path: (part.state.input?.filePath ?? part.state.input?.path ?? part.state.input?.file ?? "") as string,
                    },
                    structured,
                  ),
                )
              } else if (part.state.status === "error") {
                this._notify(
                  ACP.toolCallUpdate(
                    sessionId,
                    part.callID,
                    "failed",
                    { error: part.state.error },
                    undefined,
                    { workspace: session.workspace },
                    {
                      path: (part.state.input?.filePath ?? part.state.input?.path ?? part.state.input?.file ?? "") as string,
                    },
                  ),
                )
              }
              break
            }
          }
        })

        const unsubPartDelta = Bus.subscribe(MessageV2.Event.PartDelta, (event) => {
          const { sessionID, partID, delta } = event.properties
          if (sessionID !== sessionId) return
          const partType = partTypes.get(partID)
          if (partType === "text") this._notify(ACP.messageChunk(sessionId, delta))
          else if (partType === "reasoning") this._notify(ACP.thoughtChunk(sessionId, delta))
        })

        let sessionErrorMessage: string | undefined

        const unsubSessionError = Bus.subscribe(Session.Event.Error, (event) => {
          if (event.properties.sessionID !== sessionId) return
          const message = event.properties.error?.data?.message || "Unknown error"
          sessionErrorMessage = message
          this._notify(ACP.messageChunk(sessionId, `\n[Agent error: ${message}]\n`, { workspace: session.workspace }))
        })

        const unsubTodoUpdated = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID !== sessionId) return

          try {
            this._notify(
              ACP.planUpdate(
                sessionId,
                todoToPlanEntries(event.properties.todos),
                { workspace: session.workspace },
              ),
            )
          } catch (error) {
            console.error(`[acp] failed to emit plan update for ${sessionId}:`, error)
          }
        })

        try {
          const result = await this.executePromptInvocation(sessionId, invocation, providerMeta)

          const assistantErrorMessage =
            result &&
            typeof result === "object" &&
            "info" in result &&
            result.info &&
            typeof result.info === "object" &&
            "role" in result.info &&
            result.info.role === "assistant"
              ? (result.info as any).error?.data?.message || (result.info as any).error?.message
              : undefined

          const errorMessage = sessionErrorMessage || assistantErrorMessage

          if (errorMessage) {
            this._notify(ACP.response(requestId, { stopReason: "error", error: errorMessage }))
            return
          }
        } finally {
          unsubPartUpdated()
          unsubPartDelta()
          unsubSessionError()
          unsubTodoUpdated()
          partTypes.clear()
          delete ACPProviderMeta()[session.id]

          // Workspace diff safety net: emit synthetic notifications for any
          // files changed during the turn (catches MCP tool writes, etc.)
          if (!turnAbortController?.signal.aborted) {
            const wsDiffs = await wsDiff.computeDiffs(session.workspace).catch((err: any) => {
              console.error("[workspace-diff] computeDiffs error:", err)
              return []
            })
            let counter = 0
            for (const diff of wsDiffs) {
              if (emittedDiffPaths.has(normalizeEmittedPath(diff.absolutePath, session.workspace))) continue
              const relPath = path.relative(session.workspace, diff.absolutePath)
              const syntheticId = `ws-sync-${Date.now()}-${++counter}-${path.basename(diff.absolutePath)}`
              this._notify(ACP.toolCall(sessionId, syntheticId, "workspace-sync", { file: relPath }, session.workspace))
              this._notify(
                ACP.toolCallUpdate(
                  sessionId,
                  syntheticId,
                  "completed",
                  "File synced by external tool",
                  { type: "diff", path: diff.absolutePath, oldText: diff.oldText, newText: diff.newText },
                  { workspace: session.workspace },
                  { path: diff.absolutePath },
                ),
              )
            }
          }
        }
      },
    })

    this._notify(ACP.response(requestId, { stopReason: "end_turn" }))
  }

  private executePromptInvocation(
    sessionId: string,
    invocation: PromptInvocation,
    providerMeta: ProviderMeta,
  ) {
    if (invocation.type === "prompt") {
      return SessionPrompt.prompt({
        sessionID: sessionId as SessionID,
        model: { providerID: "reaslab" as any, modelID: (providerMeta.model || "unknown") as any },
        agent: "build",
        parts: invocation.parts,
      })
    }

    return SessionPrompt.command({
      sessionID: sessionId as SessionID,
      messageID: MessageID.ascending(),
      command: invocation.command,
      arguments: invocation.arguments,
      model: providerMeta.model,
      agent: "build",
    })
  }

  // --- Main loop ---

  async run(): Promise<void> {
    console.error("[reaslab-agent] ACP server listening on stdin...")

    for await (const line of readStdin()) {
      try {
        const request = JSON.parse(line) as JsonRpcRequest
        if (request.jsonrpc !== "2.0") {
          writeACP(ACP.error(null, -32600, "Invalid Request: not JSON-RPC 2.0"))
          continue
        }

        const response = await this.dispatch(request)

        // For notifications (no id), don't send response
        if (request.id !== undefined && request.id !== null) {
          writeACP(response)
        }
      } catch (err: any) {
        console.error("[acp] parse error:", err)
        writeACP(ACP.error(null, -32700, "Parse error"))
      }
    }

    console.error("[reaslab-agent] stdin closed, shutting down")
  }
}
