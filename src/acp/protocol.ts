// ACP Protocol Types — JSON-RPC 2.0 messages for agent ↔ reaslab-uni communication
// Reference: math-modeling-agent/src/acp_impl/protocol.py

import { Filesystem } from "@/util/filesystem"

export namespace ACP {
  // --- Tool kind mapping ---

  const ACTION_TOOLS = new Set([
    "bash",
    "execute_command",
    "compile_latex",
    "dispatch_task",
    "wait_for_next",
    "shell",
  ])

  /** Map tool name to ACP kind */
  export function toolKind(toolName: string): string {
    const name = (toolName || "").toLowerCase()

    // Sub-agent dispatch via task tool
    if (name === "task") {
      return "subagent"
    }
    // Sub-agent dispatch
    if (name.startsWith("call_") || name.includes("organizer") || name.includes("reviewer")) {
      return "think"
    }
    // Action tools
    if (ACTION_TOOLS.has(name)) {
      return "action"
    }
    // Todo/plan tools - must return "plan" for frontend to display plan UI
    if (name.includes("todo")) {
      return "plan"
    }
    // Write/edit tools
    if (name.includes("write") || name.includes("edit") || name.includes("apply_patch") || name.includes("multiedit")) {
      return "edit"
    }
    // Delete tools
    if (name.includes("delete") || name.includes("remove")) {
      return "delete"
    }
    // Search tools
    if (name.includes("search") || name.includes("grep") || name.includes("glob") || name.includes("codesearch")) {
      return "search"
    }
    // Think/plan tools
    if (name.includes("think") || name.includes("plan")) {
      return "plan"
    }
    // Read tools
    if (name.includes("read") || name.includes("fetch")) {
      return "read"
    }
    // Default
    return "action"
  }

  // --- Session update notifications ---

  export interface UpdateMeta {
    source: string
    agent_name: string
    [key: string]: unknown
  }

  export interface PlanEntry {
    content: string
    priority: "high" | "medium" | "low"
    status: "pending" | "in_progress" | "completed"
  }

  export interface SessionBootstrapResult {
    sessionId: string
    workspace: string
    plan: {
      entries: PlanEntry[]
    }
  }

  const DEFAULT_META: UpdateMeta = {
    source: "mainagent",
    agent_name: "default",
  }

  /** Create agent_message_chunk notification */
  export function messageChunk(sessionId: string, text: string, meta?: Partial<UpdateMeta>) {
    const workspace = typeof meta?.workspace === "string" ? meta.workspace : undefined
    return {
      jsonrpc: "2.0" as const,
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: relativizeText(text, workspace) },
        },
        _meta: { ...DEFAULT_META, ...meta },
      },
    }
  }

  /** Create agent_thought_chunk notification */
  export function thoughtChunk(sessionId: string, text: string, meta?: Partial<UpdateMeta>) {
    return {
      jsonrpc: "2.0" as const,
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text },
        },
        _meta: { ...DEFAULT_META, ...meta },
      },
    }
  }

  function relativizeText(text: string, workspace?: string): string {
    if (!text || !workspace) return text

    const normalizedWorkspace = normalizeDisplayPath(workspace)
    const variants = [normalizedWorkspace]
    if (/^[A-Z]:/i.test(normalizedWorkspace)) {
      variants.push(normalizedWorkspace.replace(/^[A-Z]/, (drive) => drive.toLowerCase()))
      variants.push(normalizedWorkspace.replace(/^[a-z]/, (drive) => drive.toUpperCase()))
    }
    try {
      const resolvedWorkspace = normalizeDisplayPath(Filesystem.resolve(workspace))
      variants.push(resolvedWorkspace)
      if (/^[A-Z]:/i.test(resolvedWorkspace)) {
        variants.push(resolvedWorkspace.replace(/^[A-Z]/, (drive) => drive.toLowerCase()))
        variants.push(resolvedWorkspace.replace(/^[a-z]/, (drive) => drive.toUpperCase()))
      }
    } catch {
      // Keep original workspace only.
    }

    let result = normalizeDisplayPath(text)
    for (const variant of new Set(variants.filter(Boolean))) {
      const escapedVariant = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      result = result.replace(new RegExp(`${escapedVariant}(?=$|/)`, "g"), "/")
    }
    return result.replace(/\/+/g, "/")
  }

  function normalizeDisplayPath(path: string): string {
    if (!path) return path

    const normalized = path.replace(/\\+/g, "/")
    return normalized.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toUpperCase()}:`)
  }

  function normalizeComparePath(path: string): string {
    const normalized = normalizeDisplayPath(path).replace(/\/+$/, "")
    if (/^[A-Z]:/i.test(normalized)) return normalized.toLowerCase()
    return normalized || "/"
  }

  function outsideWorkspaceDisplayPath(path: string): string {
    const normalized = normalizeDisplayPath(path)
    const withoutRoot = normalized
      .replace(/^[A-Z]:\/?/i, "")
      .replace(/^\//, "")
    const segments = withoutRoot.split("/").filter(Boolean)

    if (segments.length === 0) return normalized
    if (segments.length === 1) return `.../${segments[0]}`
    return `.../${segments.slice(-2).join("/")}`
  }

  export function relativePath(p: string, workspace?: string): string {
    if (!p) return p

    const normalizedPath = normalizeDisplayPath(p)
    if (!workspace) return normalizedPath

    const normalizedWorkspace = normalizeComparePath(workspace)
    const comparablePath = normalizeComparePath(normalizedPath)

    if (comparablePath === normalizedWorkspace) return "/"

    const workspaceDisplay = normalizeDisplayPath(workspace).replace(/\/+$/, "")
    const prefix = normalizedWorkspace === "/" ? "/" : `${normalizedWorkspace}/`
    if (comparablePath.startsWith(prefix)) {
      return normalizedPath.slice(workspaceDisplay.length).replace(/^[/\\]/, "") || "/"
    }

    if (/^(?:[A-Z]:\/|\/)/i.test(normalizedPath)) {
      return outsideWorkspaceDisplayPath(normalizedPath)
    }

    return normalizedPath
  }

  function textContent(text: string) {
    return {
      type: "content",
      content: {
        type: "text",
        text,
      },
    }
  }

  function textOutput(rawOutput: unknown, workspace?: string): string {
    if (typeof rawOutput === "string") {
      return relativizeText(rawOutput, workspace)
    }

    if (typeof rawOutput === "object" && rawOutput !== null && "error" in rawOutput && typeof rawOutput.error === "string") {
      return relativizeText(rawOutput.error, workspace)
    }

    try {
      return String(JSON.stringify(rawOutput) ?? rawOutput)
    } catch {
      return String(rawOutput)
    }
  }

  /** Create plan update notification */
  export function planUpdate(sessionId: string, entries: PlanEntry[], meta?: Partial<UpdateMeta>) {
    return {
      jsonrpc: "2.0" as const,
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries,
        },
        _meta: { ...DEFAULT_META, ...meta },
      },
    }
  }

  /** Extract a human-readable title from tool name + input args */
  export function toolTitle(toolName: string, rawInput: Record<string, unknown>, workspace?: string): string {
    // For MCP tools (contain underscore namespacing), just show the tool name
    if (toolName.includes("_mcp_") || toolName.startsWith("mcp_")) return toolName

    const filePath = relativePath((rawInput.filePath ?? rawInput.path ?? rawInput.file ?? "") as string, workspace)
    const pattern = (rawInput.pattern ?? rawInput.glob ?? rawInput.query ?? "") as string
    const cmd = relativizeText((rawInput.command ?? "") as string, workspace)

    switch (toolName) {
      case "task": return (rawInput.description as string) || (rawInput.subagent_type as string) || "task"
      case "bash": return cmd ? `bash: ${String(cmd).slice(0, 60)}` : "bash"
      case "read": return filePath || "read"
      case "write": return filePath || "write"
      case "edit": return filePath || "edit"
      case "multiedit": return filePath || "multiedit"
      case "workspace-sync": return filePath ? `workspace-sync: ${filePath}` : "workspace-sync"
      case "glob": return pattern || filePath || "glob"
      case "grep": return pattern ? `grep: ${String(pattern).slice(0, 40)}` : "grep"
      case "webfetch": return (rawInput.url as string) || "webfetch"
      case "websearch": return (rawInput.query as string) || "websearch"
      case "codesearch": return pattern || "codesearch"
      case "apply_patch": return filePath || "apply_patch"
      default: return toolName
    }
  }

  /** Create tool_call notification (when tool starts) */
  export function toolCall(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    rawInput: Record<string, unknown>,
    workspace?: string,
    meta?: Partial<UpdateMeta>,
  ) {
    const filePath = relativePath((rawInput.filePath ?? rawInput.path ?? rawInput.file ?? "") as string, workspace)
    return {
      jsonrpc: "2.0" as const,
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: toolTitle(toolName, rawInput, workspace),
          kind: toolKind(toolName),
          status: "pending",
          rawInput,
          rawOutput: {},
          content: [] as unknown[],
          locations: filePath ? [{ path: filePath }] : ([] as unknown[]),
        },
        _meta: { ...DEFAULT_META, ...meta },
      },
    }
  }

  /** Create tool_call_update notification (when tool completes) */
  export function toolCallUpdate(
    sessionId: string,
    toolCallId: string,
    status: "completed" | "failed",
    rawOutput: unknown,
    diff?: { type: "diff"; path: string; oldText?: string; newText: string },
    meta?: Partial<UpdateMeta>,
    location?: { path?: string },
    structured?: unknown,
  ) {
    const workspace = typeof meta?.workspace === "string" ? meta.workspace : undefined
    const normalizedDiff = diff
      ? {
          ...diff,
          path: relativePath(diff.path, workspace),
        }
      : undefined
    const outputText = rawOutput !== undefined ? textOutput(rawOutput, workspace) : ""
    const content = normalizedDiff
      ? [normalizedDiff]
      : rawOutput !== undefined
        ? [textContent(outputText)]
        : []
    const locations = location?.path
      ? [{ path: relativePath(location.path, workspace) }]
      : normalizedDiff
        ? [{ path: normalizedDiff.path }]
        : undefined
    const update = {
      sessionUpdate: "tool_call_update" as const,
      toolCallId,
      status,
      ...(rawOutput !== undefined ? { rawOutput } : {}),
      content,
      locations,
      ...(structured === undefined ? {} : { structured }),
    }
    return {
      jsonrpc: "2.0" as const,
      method: "session/update",
      params: {
        sessionId,
        update,
        _meta: { ...DEFAULT_META, ...meta },
      },
    }
  }

  // --- JSON-RPC response helpers ---

  /** Create a JSON-RPC success response */
  export function response(id: string | number, result: unknown) {
    return {
      jsonrpc: "2.0" as const,
      id,
      result,
    }
  }

  /** Create a JSON-RPC error response */
  export function error(id: string | number | null, code: number, message: string) {
    return {
      jsonrpc: "2.0" as const,
      id,
      error: { code, message },
    }
  }

  export function sessionBootstrapResult(sessionId: string, workspace: string, entries: PlanEntry[]): SessionBootstrapResult {
    return {
      sessionId,
      workspace,
      plan: {
        entries,
      },
    }
  }
}
