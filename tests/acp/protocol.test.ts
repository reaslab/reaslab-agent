import { describe, test, expect } from "bun:test"
import { ACP } from "../../src/acp/protocol"

describe("ACP Protocol", () => {
  test("creates agent_message_chunk update", () => {
    const msg = ACP.messageChunk("sess-1", "hello", { source: "mainagent", agent_name: "default" })
    expect(msg.method).toBe("session/update")
    expect(msg.params.update.sessionUpdate).toBe("agent_message_chunk")
    expect(msg.params.update.content.text).toBe("hello")
  })

  test("creates agent_thought_chunk update", () => {
    const msg = ACP.thoughtChunk("sess-1", "thinking...", { source: "mainagent", agent_name: "default" })
    expect(msg.method).toBe("session/update")
    expect(msg.params.update.sessionUpdate).toBe("agent_thought_chunk")
    expect(msg.params.update.content.text).toBe("thinking...")
  })

  test("creates tool_call update", () => {
    const msg = ACP.toolCall("sess-1", "call-1", "write_file", { path: "test.ts" })
    expect(msg.params.update.sessionUpdate).toBe("tool_call")
    expect(msg.params.update.kind).toBe("edit")
    expect(msg.params.update.status).toBe("pending")
    expect(msg.params.update.toolCallId).toBe("call-1")
    expect(msg.params.update.title).toBe("write_file")
  })

  test("relativePath normalizes exact workspace-root behavior to slash output", () => {
    expect(ACP.relativePath("/workspace", "/workspace")).toBe("/")
    expect(ACP.relativePath("C:\\repo", "c:/repo")).toBe("/")
  })

  test("relativePath handles mixed slash styles and drive-letter case differences", () => {
    expect(ACP.relativePath("c:\\repo\\src\\file.ts", "C:/repo")).toBe("src/file.ts")
    expect(ACP.relativePath("C:/repo/src/file.ts", "c:\\repo")).toBe("src/file.ts")
  })

  test("relativePath keeps same-prefix siblings outside the workspace", () => {
    expect(ACP.relativePath("C:\\repo2\\file.ts", "C:\\repo")).toBe(".../repo2/file.ts")
  })

  test("relativePath uses deterministic outside-workspace fallback", () => {
    expect(ACP.relativePath("D:\\logs\\folder\\file.ts", "C:\\repo")).toBe(".../folder/file.ts")
  })

  test("toolTitle normalizes display paths for named ACP surfaces", () => {
    expect(ACP.toolTitle("read", { filePath: "c:\\repo\\src\\index.ts" }, "C:/repo")).toBe("src/index.ts")
    expect(ACP.toolTitle("workspace-sync", { file: "c:\\repo\\notes.txt" }, "C:/repo")).toBe("workspace-sync: notes.txt")
  })

  test("tool_call locations use normalized display paths while preserving internal raw input", () => {
    const msg = ACP.toolCall("sess-1", "call-1", "read", { filePath: "c:\\repo\\src\\index.ts" }, "C:/repo")

    expect(msg.params.update.rawInput).toEqual({ filePath: "c:\\repo\\src\\index.ts" })
    expect(msg.params.update.locations).toEqual([{ path: "src/index.ts" }])
    expect(msg.params.update.title).toBe("src/index.ts")
  })

  test("creates tool_call_update", () => {
    const msg = ACP.toolCallUpdate("sess-1", "call-1", "completed", "ok")
    expect(msg.params.update.sessionUpdate).toBe("tool_call_update")
    expect(msg.params.update.status).toBe("completed")
    expect(msg.params.update.rawOutput).toBe("ok")
  })

  test("creates failed tool_call_update with structured error content", () => {
    const msg = ACP.toolCallUpdate(
      "sess-1",
      "call-1",
      "failed",
      { error: "apply_patch verification failed: no hunks found" },
      undefined,
      { workspace: "/workspace" },
      { path: "/workspace/README.md" },
    )

    expect(msg.params.update.sessionUpdate).toBe("tool_call_update")
    expect(msg.params.update.status).toBe("failed")
    expect(msg.params.update.rawOutput).toEqual({
      error: "apply_patch verification failed: no hunks found",
    })
    expect(msg.params.update.locations).toEqual([{ path: "README.md" }])
    expect(msg.params.update.content).toEqual([
      {
        type: "content",
        content: {
          type: "text",
          text: "apply_patch verification failed: no hunks found",
        },
      },
    ])
  })

  test("keeps string rawOutput unchanged and mirrors it in text content when no diff is present", () => {
    const msg = ACP.toolCallUpdate("sess-1", "call-1", "completed", "ok")

    expect(msg.params.update.rawOutput).toBe("ok")
    expect(msg.params.update.content).toEqual([
      {
        type: "content",
        content: {
          type: "text",
          text: "ok",
        },
      },
    ])
  })

  test("structured tool update supports optional additive structured payloads", () => {
    const structured = {
      type: "json",
      value: {
        status: "ok",
        count: 2,
      },
    }

    const msg = ACP.toolCallUpdate("sess-1", "call-1", "completed", "ok", undefined, undefined, undefined, structured)

    expect(msg.params.update.rawOutput).toBe("ok")
    expect(msg.params.update.structured).toEqual(structured)
  })

  test("content remains usable for string-only consumers when structured is present", () => {
    const msg = ACP.toolCallUpdate(
      "sess-1",
      "call-1",
      "completed",
      "plain text output",
      undefined,
      undefined,
      undefined,
      {
        type: "json",
        value: {
          detail: "machine readable",
        },
      },
    )

    expect(msg.params.update.content).toEqual([
      {
        type: "content",
        content: {
          type: "text",
          text: "plain text output",
        },
      },
    ])
    expect(msg.params.update.rawOutput).toBe("plain text output")
  })

  test("rawOutput undefined still produces valid text content", () => {
    const msg = ACP.toolCallUpdate("sess-1", "call-1", "completed", undefined)

    expect(msg.params.update.rawOutput).toBeUndefined()
    expect(msg.params.update.content).toEqual([
      {
        type: "content",
        content: {
          type: "text",
          text: "undefined",
        },
      },
    ])
  })

  test("rawOutput circular objects fall back to valid text content without throwing", () => {
    const circular: { self?: unknown } = {}
    circular.self = circular

    const call = () => ACP.toolCallUpdate("sess-1", "call-1", "completed", circular)

    expect(call).not.toThrow()

    const msg = call()
    expect(msg.params.update.rawOutput).toBe(circular)
    expect(msg.params.update.content).toEqual([
      {
        type: "content",
        content: {
          type: "text",
          text: "[object Object]",
        },
      },
    ])
  })

  test("diff updates keep rawOutput and relativize diff paths", () => {
    const msg = ACP.toolCallUpdate(
      "sess-1",
      "call-1",
      "completed",
      "patched",
      {
        type: "diff",
        path: "/workspace/src/acp/protocol.ts",
        newText: "new text",
      },
      { workspace: "/workspace" },
    )

    expect(msg.params.update.rawOutput).toBe("patched")
    expect(msg.params.update.content).toEqual([
      {
        type: "diff",
        path: "src/acp/protocol.ts",
        newText: "new text",
      },
    ])
    expect(msg.params.update.locations).toEqual([{ path: "src/acp/protocol.ts" }])
  })

  test("tool_call_update locations normalize display paths and preserve internal absolute payload data", () => {
    const msg = ACP.toolCallUpdate(
      "sess-1",
      "call-1",
      "completed",
      { savedTo: "C:\\repo\\src\\index.ts" },
      {
        type: "diff",
        path: "c:\\repo\\src\\index.ts",
        newText: "export {}",
      },
      { workspace: "C:/repo" },
      { path: "C:\\repo\\src\\index.ts" },
    )

    expect(msg.params.update.rawOutput).toEqual({ savedTo: "C:\\repo\\src\\index.ts" })
    expect(msg.params.update.content).toEqual([
      {
        type: "diff",
        path: "src/index.ts",
        newText: "export {}",
      },
    ])
    expect(msg.params.update.locations).toEqual([{ path: "src/index.ts" }])
  })

  test("tool_call_update keeps internal absolute-path fields available when structured output is also present", () => {
    const msg = ACP.toolCallUpdate(
      "sess-1",
      "call-1",
      "completed",
      { savedTo: "C:\\repo\\src\\index.ts" },
      undefined,
      { workspace: "C:/repo" },
      { path: "C:\\repo\\src\\index.ts" },
      {
        savedTo: "C:\\repo\\src\\index.ts",
      },
    )

    expect(msg.params.update.rawOutput).toEqual({ savedTo: "C:\\repo\\src\\index.ts" })
    expect(msg.params.update.structured).toEqual({ savedTo: "C:\\repo\\src\\index.ts" })
    expect(msg.params.update.locations).toEqual([{ path: "src/index.ts" }])
    expect(msg.params.update.content).toEqual([
      {
        type: "content",
        content: {
          type: "text",
          text: JSON.stringify({ savedTo: "C:\\repo\\src\\index.ts" }),
        },
      },
    ])
  })

  test("tool_call_update transcript-visible locations text uses slash-normalized display output", () => {
    const msg = ACP.toolCallUpdate(
      "sess-1",
      "call-1",
      "failed",
      { error: "Failed at C:\\repo\\src\\index.ts from c:/repo" },
      undefined,
      { workspace: "C:/repo" },
    )

    expect(msg.params.update.content).toEqual([
      {
        type: "content",
        content: {
          type: "text",
          text: "Failed at /src/index.ts from /",
        },
      },
    ])
  })

  test("tool_call_update transcript-visible locations text does not mangle same-prefix sibling paths", () => {
    const msg = ACP.toolCallUpdate(
      "sess-1",
      "call-1",
      "failed",
      { error: "Failed at C:/repo2/file.ts while workspace is C:/repo" },
      undefined,
      { workspace: "C:/repo" },
    )

    expect(msg.params.update.content).toEqual([
      {
        type: "content",
        content: {
          type: "text",
          text: "Failed at C:/repo2/file.ts while workspace is /",
        },
      },
    ])
  })

  test("no existing protocol expectation breaks when structured is absent", () => {
    const msg = ACP.toolCallUpdate("sess-1", "call-1", "completed", { result: "ok" })

    expect(msg.params.update).toEqual({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      rawOutput: { result: "ok" },
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: JSON.stringify({ result: "ok" }),
          },
        },
      ],
      locations: undefined,
    })
    expect("structured" in msg.params.update).toBe(false)
  })

  test("creates plan update notifications", () => {
    const msg = ACP.planUpdate("sess-1", [
      { content: "Inspect project context", priority: "high", status: "in_progress" },
      { content: "Write tests", priority: "medium", status: "completed" },
    ])

    expect(msg.method).toBe("session/update")
    expect(msg.params.sessionId).toBe("sess-1")
    expect(msg.params.update).toEqual({
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect project context", priority: "high", status: "in_progress" },
        { content: "Write tests", priority: "medium", status: "completed" },
      ],
    })
  })

  test("frontend contract plan entries keep session/update(plan) payload limited to sessionUpdate and entries", () => {
    const msg = ACP.planUpdate("sess-1", [
      { content: "Lock frontend plan payload", priority: "high", status: "pending" },
    ])

    expect(Object.keys(msg.params.update).sort()).toEqual([
      "entries",
      "sessionUpdate",
    ])
    expect(msg.params.update.sessionUpdate).toBe("plan")
    expect(msg.params.update.entries).toEqual([
      { content: "Lock frontend plan payload", priority: "high", status: "pending" },
    ])
  })

  test("session bootstrap result includes additive plan entries alongside sessionId and workspace", () => {
    const result = ACP.sessionBootstrapResult("sess-1", "/workspace", [
      { content: "Bootstrap entry", priority: "high", status: "pending" },
    ])

    expect(result).toEqual({
      sessionId: "sess-1",
      workspace: "/workspace",
      plan: {
        entries: [
          { content: "Bootstrap entry", priority: "high", status: "pending" },
        ],
      },
    })
  })

  test("frontend contract structured tool update keeps additive structured payload nested beside legacy fields", () => {
    const msg = ACP.toolCallUpdate(
      "sess-1",
      "call-1",
      "completed",
      "1 todo\nCurrent focus: Lock ACP contract",
      undefined,
      undefined,
      undefined,
      {
        todos: [
          {
            content: "Lock ACP contract",
            status: "in_progress",
            priority: "high",
          },
        ],
        summary: {
          total: 1,
          inProgress: 1,
          pending: 0,
          completed: 0,
          cancelled: 0,
        },
      },
    )

    expect(Object.keys(msg.params.update).sort()).toEqual([
      "content",
      "locations",
      "rawOutput",
      "sessionUpdate",
      "status",
      "structured",
      "toolCallId",
    ])
    expect(msg.params.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      rawOutput: "1 todo\nCurrent focus: Lock ACP contract",
      structured: {
        todos: [
          {
            content: "Lock ACP contract",
            status: "in_progress",
            priority: "high",
          },
        ],
        summary: {
          total: 1,
          inProgress: 1,
          pending: 0,
          completed: 0,
          cancelled: 0,
        },
      },
    })
  })

  test("maps tool names to kinds", () => {
    expect(ACP.toolKind("write_file")).toBe("edit")
    expect(ACP.toolKind("edit_file")).toBe("edit")
    expect(ACP.toolKind("read_file")).toBe("read")
    expect(ACP.toolKind("bash")).toBe("action")
    expect(ACP.toolKind("grep")).toBe("search")
    expect(ACP.toolKind("glob")).toBe("search")
    expect(ACP.toolKind("codesearch")).toBe("search")
    expect(ACP.toolKind("webfetch")).toBe("read")
    expect(ACP.toolKind("websearch")).toBe("search")
    expect(ACP.toolKind("apply_patch")).toBe("edit")
    expect(ACP.toolKind("unknown_tool")).toBe("action")
  })

  test("creates JSON-RPC response", () => {
    const resp = ACP.response("1", { ok: true })
    expect(resp.jsonrpc).toBe("2.0")
    expect(resp.id).toBe("1")
    expect(resp.result).toEqual({ ok: true })
  })

  test("creates JSON-RPC error", () => {
    const err = ACP.error("1", -32601, "Method not found")
    expect(err.jsonrpc).toBe("2.0")
    expect(err.error.code).toBe(-32601)
    expect(err.error.message).toBe("Method not found")
  })

  test("includes _meta in notifications", () => {
    const msg = ACP.messageChunk("sess-1", "hi", { agent_name: "build" })
    expect(msg.params._meta.source).toBe("mainagent")
    expect(msg.params._meta.agent_name).toBe("build")
  })

  test("includes _meta in plan notifications", () => {
    const msg = ACP.planUpdate("sess-1", [], { agent_name: "build", workspace: "/workspace" })

    expect(msg.params._meta).toEqual({
      source: "mainagent",
      agent_name: "build",
      workspace: "/workspace",
    })
  })
})
