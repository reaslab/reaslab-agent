import { describe, test, expect } from "bun:test"
import { ACPServer } from "../../src/acp/server"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { NamedError } from "@opencode-ai/util/error"

describe("ACPServer", () => {
  test("handles initialize", async () => {
    const server = new ACPServer()
    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "initialize",
      params: {},
    })
    expect(result.result.protocolVersion).toBeDefined()
    expect(result.result.capabilities).toBeDefined()
    expect(result.result.capabilities.streaming).toBe(true)
    expect(result.result.serverInfo.name).toBe("reaslab-agent")
  })

  test("handles authenticate", async () => {
    const server = new ACPServer()
    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "2",
      method: "authenticate",
      params: {},
    })
    expect(result.result.authenticated).toBe(true)
  })

  test("handles session/new", async () => {
    const server = new ACPServer()
    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "3",
      method: "session/new",
      params: { cwd: "/workspace", mcpServers: [] },
    })
    expect(result.result.sessionId).toBeDefined()
    expect(result.result.workspace).toBe("/workspace")
  })

  test("handles session/load for existing session", async () => {
    const server = new ACPServer()
    const created = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "/test" },
    })
    const sessionId = created.result.sessionId

    const loaded = await server.dispatch({
      jsonrpc: "2.0",
      id: "2",
      method: "session/load",
      params: { sessionId },
    })
    expect(loaded.result.sessionId).toBe(sessionId)
  })

  test("returns error for unknown method", async () => {
    const server = new ACPServer()
    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "4",
      method: "unknown/method",
      params: {},
    })
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe(-32601)
  })

  test("handles session/prompt (async, returns null)", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    // Create session first
    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "/workspace" },
    })

    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "2",
      method: "session/prompt",
      params: {
        sessionId: sess.result.sessionId,
        prompt: "Hello!",
        _meta: {
          model: "test-model",
          baseUrl: "http://localhost",
          apiKey: "test-key",
        },
      },
    })

    // Immediate response is null
    expect(result.result).toBeNull()

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Should have received notifications
    expect(notifications.length).toBeGreaterThan(0)
  })

  test("handles session/cancel", async () => {
    const server = new ACPServer()

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "/workspace" },
    })

    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "3",
      method: "session/cancel",
      params: { sessionId: sess.result.sessionId },
    })

    expect(result.result.cancelled).toBe(true)
  })

  test("parsePromptToInputParts handles string", () => {
    const server = new ACPServer()
    const parts = server.parsePromptToInputParts("hello")
    expect(parts).toEqual([{ type: "text", text: "hello" }])
  })

  test("parsePromptToInputParts handles array with mixed types", () => {
    const server = new ACPServer()
    const parts = server.parsePromptToInputParts([
      { type: "text", text: "hello" },
      { type: "resource", resource: { text: "file content" } },
      { type: "resource_link", uri: "file:///test.ts", name: "test.ts", mimeType: "text/typescript" },
    ])
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ type: "text", text: "hello" })
    expect(parts[1]).toEqual({ type: "text", text: "file content" })
    expect(parts[2]).toEqual({
      type: "file",
      url: "file:///test.ts",
      filename: "test.ts",
      mime: "text/typescript",
    })
  })

  test("session/prompt sends ACP error notification when session is busy", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "/workspace" },
    })

    ;(server as any).executeAgentLoop = () =>
      Promise.reject(new Session.BusyError(sess.result.sessionId))

    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "2",
      method: "session/prompt",
      params: {
        sessionId: sess.result.sessionId,
        prompt: "Hello!",
        _meta: {
          model: "test-model",
          baseUrl: "http://localhost",
          apiKey: "test-key",
        },
      },
    })

    expect(result.result).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(notifications).toContainEqual({
      jsonrpc: "2.0",
      id: "2",
      error: {
        code: -32603,
        message: `Session is busy: ${sess.result.sessionId}`,
      },
    })
  })

  test("session/prompt emits visible error chunk when agent loop fails", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "/workspace" },
    })

    ;(server as any).executeAgentLoop = async () => {
      throw new Error("provider failed")
    }

    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "2",
      method: "session/prompt",
      params: {
        sessionId: sess.result.sessionId,
        prompt: "Hello!",
        _meta: {
          model: "test-model",
          baseUrl: "http://localhost",
          apiKey: "test-key",
        },
      },
    })

    expect(result.result).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(notifications).toContainEqual({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: sess.result.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "\n[Agent error: provider failed]\n",
          },
        },
        _meta: {
          source: "mainagent",
          agent_name: "default",
        },
      },
    })
  })

  test("session/prompt emits visible error chunk when session publishes an internal error", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "/workspace" },
    })

    const originalPrompt = (SessionPrompt as any).prompt
    ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
      await Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: new NamedError.Unknown({ message: "provider failed" }).toObject(),
      })
      return undefined
    }

    try {
      const result = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId: sess.result.sessionId,
          prompt: "Hello!",
          _meta: {
            model: "test-model",
            baseUrl: "http://localhost",
            apiKey: "test-key",
          },
        },
      })

      expect(result.result).toBeNull()
      await waitFor(() =>
        notifications.some(
          (msg) =>
            (msg as any).method === "session/update" &&
            (msg as any).params?.update?.sessionUpdate === "agent_message_chunk",
        ),
      )
      expect(notifications).toContainEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: sess.result.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "\n[Agent error: provider failed]\n",
            },
          },
          _meta: {
            source: "mainagent",
            agent_name: "default",
          },
        },
      })
      expect(notifications).toContainEqual({
        jsonrpc: "2.0",
        id: "2",
        result: {
          stopReason: "error",
          error: "provider failed",
        },
      })
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
    }
  })

  test("session/prompt emits failed tool_call_update for tool errors", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "/workspace" },
    })

    const originalPrompt = (SessionPrompt as any).prompt
    ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: input.sessionID as any,
          type: "tool",
          callID: "call-1",
          tool: "apply_patch",
          state: {
            status: "error",
            input: { filePath: "/workspace/README.md" },
            error: "apply_patch verification failed: no hunks found",
            time: { start: Date.now(), end: Date.now() },
          },
        },
      })
      return undefined
    }

    try {
      const result = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId: sess.result.sessionId,
          prompt: "Hello!",
          _meta: {
            model: "test-model",
            baseUrl: "http://localhost",
            apiKey: "test-key",
          },
        },
      })

      expect(result.result).toBeNull()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(notifications).toContainEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: sess.result.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "failed",
            rawOutput: {
              error: "apply_patch verification failed: no hunks found",
            },
            locations: [{ path: "README.md" }],
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "apply_patch verification failed: no hunks found",
                },
              },
            ],
          },
          _meta: {
            source: "mainagent",
            agent_name: "default",
            workspace: "/workspace",
          },
        },
      })
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
    }
  })
})

async function waitFor(check: () => boolean, timeout = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for condition")
}
