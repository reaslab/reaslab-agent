import { describe, test, expect } from "bun:test"
import { ACPServer } from "../../src/acp/server"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { NamedError } from "@opencode-ai/util/error"
import { Todo } from "../../src/session/todo"

const TEST_WORKSPACE = "/tmp/test-workspace"

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
      params: { cwd: TEST_WORKSPACE },
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

    await waitFor(() => notifications.length > 0)

    // Should have received notifications
    expect(notifications.length).toBeGreaterThan(0)
  })

  test("handles session/cancel", async () => {
    const server = new ACPServer()

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
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

  describe("slash prompt resolution", () => {
    test("resolves /init as slash command", () => {
      const server = new ACPServer()

      expect((server as any).resolvePromptInvocation("/init")).toEqual({
        type: "command",
        command: "init",
        arguments: "",
      })
    })

    test("resolves /review HEAD~1 as slash command", () => {
      const server = new ACPServer()

      expect((server as any).resolvePromptInvocation("/review HEAD~1")).toEqual({
        type: "command",
        command: "review",
        arguments: "HEAD~1",
      })
    })

    test("resolves multiline slash arguments", () => {
      const server = new ACPServer()

      expect((server as any).resolvePromptInvocation("/review HEAD~1\nfocus acp")).toEqual({
        type: "command",
        command: "review",
        arguments: "HEAD~1\nfocus acp",
      })
    })

    test("returns an empty-command error for slash-only input", () => {
      const server = new ACPServer()

      expect(() => (server as any).resolvePromptInvocation("/")).toThrow("Empty slash command")
    })

    test("does not recognize slash commands with leading whitespace", () => {
      const server = new ACPServer()

      expect((server as any).resolvePromptInvocation(" /init")).toEqual({
        type: "prompt",
        parts: [{ type: "text", text: " /init" }],
      })
    })

    test("does not recognize plain text as a slash command", () => {
      const server = new ACPServer()

      expect((server as any).resolvePromptInvocation("hello")).toEqual({
        type: "prompt",
        parts: [{ type: "text", text: "hello" }],
      })
    })

    test("keeps structured prompt arrays in normal prompt mode", () => {
      const server = new ACPServer()
      const prompt = [{ type: "text", text: "/init" }]

      expect((server as any).resolvePromptInvocation(prompt)).toEqual({
        type: "prompt",
        parts: [{ type: "text", text: "/init" }],
      })
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
      params: { cwd: TEST_WORKSPACE },
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
      params: { cwd: TEST_WORKSPACE },
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
      params: { cwd: TEST_WORKSPACE },
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
      params: { cwd: TEST_WORKSPACE },
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
      await waitFor(() =>
        notifications.some(
          (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "tool_call_update",
        ),
      )
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
            locations: [{ path: "/workspace/README.md" }],
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
            workspace: TEST_WORKSPACE,
          },
        },
      })
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
    }
  })

  test("emits plan updates when todos change", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const sessionId = sess.result.sessionId
    const originalPrompt = (SessionPrompt as any).prompt
    ;(SessionPrompt as any).prompt = async () => {
      await Bus.publish(Todo.Event.Updated, {
        sessionID: sessionId,
        todos: [
          {
            content: "Implement ACP projection",
            status: "in_progress",
            priority: "high",
          },
          {
            content: "Skip obsolete fallback",
            status: "cancelled",
            priority: "low",
          },
        ],
      })

      await Bus.publish(Todo.Event.Updated, {
        sessionID: sessionId,
        todos: [
          {
            content: "Only latest snapshot remains",
            status: "pending",
            priority: "medium",
          },
        ],
      })
    }

    try {
      const result = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId,
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
        notifications.filter(
          (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "plan",
        ).length === 2,
      )

      const planNotifications = notifications.filter(
        (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "plan",
      )

      expect(planNotifications).toHaveLength(2)
      expect(planNotifications[0]).toEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Implement ACP projection",
                status: "in_progress",
                priority: "high",
              },
              {
                content: "Skip obsolete fallback",
                status: "completed",
                priority: "low",
              },
            ],
          },
          _meta: {
            source: "mainagent",
            agent_name: "default",
            workspace: TEST_WORKSPACE,
          },
        },
      })
      expect(planNotifications[1]).toEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Only latest snapshot remains",
                status: "pending",
                priority: "medium",
              },
            ],
          },
          _meta: {
            source: "mainagent",
            agent_name: "default",
            workspace: TEST_WORKSPACE,
          },
        },
      })
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
    }
  })

  test("emits plan updates when todowrite updates todos", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const sessionId = sess.result.sessionId
    const originalPrompt = (SessionPrompt as any).prompt
    ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
      Todo.update({
        sessionID: input.sessionID as any,
        todos: [
          {
            content: "Write through todo tool",
            status: "in_progress",
            priority: "high",
          },
        ],
      })
    }

    try {
      const result = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId,
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
          (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "plan",
        ),
      )

      const planNotification = notifications.find(
        (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "plan",
      )

      expect(planNotification).toEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Write through todo tool",
                status: "in_progress",
                priority: "high",
              },
            ],
          },
          _meta: {
            source: "mainagent",
            agent_name: "default",
            workspace: TEST_WORKSPACE,
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
