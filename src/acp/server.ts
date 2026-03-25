// ACP Server — stdin/stdout JSON-RPC 2.0 dispatcher
// Reference: math-modeling-agent/src/acp_impl/server.py

import { ACP } from "./protocol"
import { writeACP, readStdin } from "./stdio"
import { Provider, type ProviderMeta } from "../provider/provider"
import { Agent } from "../agent/agent"
import { streamText, stepCountIs, type ToolSet } from "ai"
import { Boot } from "../boot"
import { MCP } from "../mcp"
import { Instance } from "../project/instance"
import { buildBuiltinTools } from "./builtin-tools"

const PROTOCOL_VERSION = "0.1.0"

interface SessionState {
  id: string
  workspace: string
  mcpServers: MCPServerConfig[]
  meta: Record<string, unknown>
  abortController?: AbortController
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

/** Callback interface for routing processor events to ACP notifications */
export interface ProcessorCallbacks {
  onTextDelta: (sessionId: string, text: string) => void
  onThinkingDelta: (sessionId: string, text: string) => void
  onToolCall: (sessionId: string, toolCallId: string, name: string, input: Record<string, unknown>) => void
  onToolResult: (sessionId: string, toolCallId: string, status: "completed" | "failed", output: unknown) => void
}

export class ACPServer {
  private sessions = new Map<string, SessionState>()
  private sessionCounter = 0

  /** Optional hook for tests to capture notifications */
  onNotification?: (msg: unknown) => void

  /** Create ACP callbacks wired to writeACP */
  createCallbacks(): ProcessorCallbacks {
    const self = this
    return {
      onTextDelta(sessionId: string, text: string) {
        const msg = ACP.messageChunk(sessionId, text)
        self._notify(msg)
      },
      onThinkingDelta(sessionId: string, text: string) {
        const msg = ACP.thoughtChunk(sessionId, text)
        self._notify(msg)
      },
      onToolCall(sessionId: string, toolCallId: string, name: string, input: Record<string, unknown>) {
        const msg = ACP.toolCall(sessionId, toolCallId, name, input)
        self._notify(msg)
      },
      onToolResult(sessionId: string, toolCallId: string, status: "completed" | "failed", output: unknown) {
        const msg = ACP.toolCallUpdate(sessionId, toolCallId, status, output)
        self._notify(msg)
      },
    }
  }

  private _notify(msg: unknown) {
    if (this.onNotification) {
      this.onNotification(msg)
    }
    writeACP(msg as object)
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
          return ACP.response(id!, this.handleSessionNew(params || {}))
        case "session/load":
          return ACP.response(id!, this.handleSessionLoad(params || {}))
        case "session/prompt":
          return ACP.response(id!, await this.handleSessionPrompt(params || {}, id!))
        case "session/cancel":
          return ACP.response(id!, this.handleSessionCancel(params || {}))
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

  private handleSessionNew(params: Record<string, unknown>) {
    this.sessionCounter++
    const sessionId = `session-${this.sessionCounter}-${Date.now()}`

    const session: SessionState = {
      id: sessionId,
      workspace: (params.cwd as string) || "/workspace",
      mcpServers: (params.mcpServers as MCPServerConfig[]) || [],
      meta: {},
    }

    this.sessions.set(sessionId, session)

    return {
      sessionId,
      workspace: session.workspace,
    }
  }

  private handleSessionLoad(params: Record<string, unknown>) {
    const sessionId = params.sessionId as string
    if (!sessionId) {
      throw new Error("sessionId is required")
    }

    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // reaslab re-sends cwd and mcpServers on session/load (agent switch) — update them
    if (params.cwd) session.workspace = params.cwd as string
    if (params.mcpServers) session.mcpServers = params.mcpServers as MCPServerConfig[]

    return {
      sessionId: session.id,
      workspace: session.workspace,
    }
  }

  private async handleSessionPrompt(params: Record<string, unknown>, requestId: string | number): Promise<null> {
    const sessionId = params.sessionId as string
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const meta = (params._meta || params.meta || {}) as Record<string, unknown>
    const prompt = params.prompt as string | unknown[]

    // Parse prompt content types
    const userMessage = this.parsePromptContent(prompt)

    // Extract provider meta
    const providerMeta: ProviderMeta = {
      model: (meta.model as string) || "",
      baseUrl: (meta.baseUrl as string) || "",
      apiKey: (meta.apiKey as string) || "",
      reasoningEffort: meta.reasoningEffort as string | undefined,
      maxTokens: meta.maxTokens as number | undefined,
    }

    // Create abort controller for this task
    const abortController = new AbortController()
    session.abortController = abortController

    // Spawn async — don't await
    // TODO: Wire to actual session processor in Task 13
    this.executeAgentLoop(sessionId, userMessage, providerMeta, session, abortController.signal)
      .then(() => {
        this._notify(ACP.response(requestId, { stopReason: "end_turn" }))
      })
      .catch((err) => {
        console.error(`[acp] agent loop error for ${sessionId}:`, err)
        this._notify(ACP.response(requestId, { stopReason: "error", error: err.message }))
      })
      .finally(() => {
        session.abortController = undefined
      })

    // Respond immediately with null (async processing)
    return null
  }

  private handleSessionCancel(params: Record<string, unknown>) {
    const sessionId = params.sessionId as string
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.abortController) {
      session.abortController.abort()
      session.abortController = undefined
    }

    return { cancelled: true }
  }

  // --- Prompt parsing ---

  /** Parse ACP prompt content types into a user message */
  parsePromptContent(prompt: string | unknown[]): UserMessage {
    if (typeof prompt === "string") {
      return { role: "user", parts: [{ type: "text", text: prompt }] }
    }

    if (!Array.isArray(prompt)) {
      return { role: "user", parts: [{ type: "text", text: String(prompt) }] }
    }

    const parts: MessagePart[] = prompt.map((block: any) => {
      if (block.type === "text") return { type: "text" as const, text: block.text }
      if (block.type === "resource") return { type: "text" as const, text: block.resource?.text || "" }
      if (block.type === "resource_link") return { type: "file" as const, uri: block.uri, name: block.name }
      return { type: "text" as const, text: JSON.stringify(block) }
    })

    return { role: "user", parts }
  }

  // --- Agent loop ---

  private async executeAgentLoop(
    sessionId: string,
    userMessage: UserMessage,
    providerMeta: ProviderMeta,
    session: SessionState,
    signal: AbortSignal,
  ): Promise<void> {
    await Boot.init(session.workspace)

    await Instance.provide({
      directory: session.workspace,
      fn: () => this._runAgentLoop(sessionId, userMessage, providerMeta, session, signal),
    })
  }

  private async _runAgentLoop(
    sessionId: string,
    userMessage: UserMessage,
    providerMeta: ProviderMeta,
    session: SessionState,
    signal: AbortSignal,
  ): Promise<void> {
    // Connect MCP servers if provided
    if (session.mcpServers.length > 0) {
      const serverMap: Record<string, { url: string; headers?: Record<string, string> }> = {}
      for (const srv of session.mcpServers) {
        const headers: Record<string, string> = {}
        for (const h of srv.headers || []) {
          headers[h.name] = h.value
        }
        serverMap[srv.name] = { url: srv.url, headers }
      }
      await MCP.connectFromACP(serverMap).catch((err: any) => {
        console.error("[acp] MCP connection error:", err.message)
      })
    }

    const callbacks = this.createCallbacks()

    // Get the language model from meta
    const language = Provider.fromMeta(providerMeta)

    // Get agent definition
    const agent = await Agent.get("build")

    // Build user message text
    const userText = userMessage.parts
      .map((p) => (p.type === "text" ? p.text : `[File: ${p.name}]`))
      .filter(Boolean)
      .join("\n")

    // Get tools from MCP and built-ins, merge them
    const [mcpTools, builtinTools] = await Promise.all([
      MCP.tools().catch(() => ({} as ToolSet)),
      buildBuiltinTools(signal),
    ])
    const allTools: ToolSet = { ...builtinTools, ...mcpTools }

    // Build system prompt
    const systemParts: string[] = []
    if (agent.prompt) systemParts.push(agent.prompt)
    systemParts.push(`You are working in directory: ${session.workspace}`)
    systemParts.push(`Current date: ${new Date().toISOString().split("T")[0]}`)

    // Stream with Vercel AI SDK
    const result = streamText({
      model: language,
      system: systemParts.join("\n\n"),
      messages: [{ role: "user", content: userText }],
      tools: allTools,
      stopWhen: stepCountIs(50),
      abortSignal: signal,
    })

    // Process stream events and emit ACP notifications
    for await (const event of result.fullStream) {
      signal.throwIfAborted()

      switch (event.type) {
        case "text-delta":
          callbacks.onTextDelta(sessionId, (event as any).delta ?? (event as any).text ?? "")
          break

        case "reasoning-delta":
          callbacks.onThinkingDelta(sessionId, (event as any).delta ?? "")
          break

        case "tool-call":
          callbacks.onToolCall(sessionId, event.toolCallId, event.toolName, (event.input ?? {}) as Record<string, unknown>)
          break

        case "tool-result":
          callbacks.onToolResult(sessionId, event.toolCallId, "completed", event.output)
          break

        case "tool-error":
          callbacks.onToolResult(sessionId, event.toolCallId, "failed", String(event.error))
          break

        case "error":
          console.error("[acp] stream error:", event.error)
          break
      }
    }
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

// --- Types ---

interface MessagePart {
  type: "text" | "file"
  text?: string
  uri?: string
  name?: string
}

interface UserMessage {
  role: "user"
  parts: MessagePart[]
}
