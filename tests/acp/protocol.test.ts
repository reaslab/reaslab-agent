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

  test("creates tool_call_update", () => {
    const msg = ACP.toolCallUpdate("sess-1", "call-1", "completed", "ok", [{ type: "text", text: "done" }])
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
})
