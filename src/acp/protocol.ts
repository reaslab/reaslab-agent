// ACP Protocol Types — JSON-RPC 2.0 messages for agent ↔ reaslab-uni communication
// Reference: math-modeling-agent/src/acp_impl/protocol.py

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

    // Sub-agent dispatch
    if (name.startsWith("call_") || name.includes("organizer") || name.includes("reviewer")) {
      return "think"
    }
    // Action tools
    if (ACTION_TOOLS.has(name)) {
      return "action"
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
      return "think"
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

  const DEFAULT_META: UpdateMeta = {
    source: "mainagent",
    agent_name: "default",
  }

  /** Create agent_message_chunk notification */
  export function messageChunk(sessionId: string, text: string, meta?: Partial<UpdateMeta>) {
    return {
      jsonrpc: "2.0" as const,
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
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

  /** Extract a human-readable title from tool name + input args */
  export function toolTitle(toolName: string, rawInput: Record<string, unknown>, workspace?: string): string {
    // For MCP tools (contain underscore namespacing), just show the tool name
    if (toolName.includes("_mcp_") || toolName.startsWith("mcp_")) return toolName

    // Strip workspace prefix from absolute paths for readability
    const rel = (p: string) => {
      if (!p) return p
      if (workspace && p.startsWith(workspace)) {
        return p.slice(workspace.length).replace(/^\//, "") || p
      }
      return p
    }

    const path = rel((rawInput.filePath ?? rawInput.path ?? rawInput.file ?? "") as string)
    const pattern = (rawInput.pattern ?? rawInput.glob ?? rawInput.query ?? "") as string
    const cmd = (rawInput.command ?? "") as string

    switch (toolName) {
      case "bash": return cmd ? `bash: ${String(cmd).slice(0, 60)}` : "bash"
      case "read": return path || "read"
      case "write": return path || "write"
      case "edit": return path || "edit"
      case "multiedit": return path || "multiedit"
      case "glob": return pattern || path || "glob"
      case "grep": return pattern ? `grep: ${String(pattern).slice(0, 40)}` : "grep"
      case "webfetch": return (rawInput.url as string) || "webfetch"
      case "websearch": return (rawInput.query as string) || "websearch"
      case "codesearch": return pattern || "codesearch"
      case "apply_patch": return path || "apply_patch"
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
          locations: [] as unknown[],
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
  ) {
    const outputText = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput)
    const content = diff ? [diff] : [{ type: "text", text: outputText }]
    return {
      jsonrpc: "2.0" as const,
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status,
          rawOutput,
          content,
        },
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
}
