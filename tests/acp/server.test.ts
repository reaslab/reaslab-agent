import { describe, test, expect } from "bun:test"
import { ACPServer } from "../../src/acp/server"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { NamedError } from "@opencode-ai/util/error"
import { Todo } from "../../src/session/todo"
import { WorkspaceDiffer } from "../../src/acp/workspace-diff"
import { Boot } from "../../src/boot"
import { Instance } from "../../src/project/instance"

const TEST_WORKSPACE = "/tmp/test-workspace"

type PromptResult = Awaited<ReturnType<typeof SessionPrompt.prompt>>
type PromptInput = Parameters<typeof SessionPrompt.prompt>[0]
type CommandInput = Parameters<typeof SessionPrompt.command>[0]

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

  test("session/new returns empty plan state", async () => {
    const server = new ACPServer()
    const result = await server.dispatch({
      jsonrpc: "2.0",
      id: "3",
      method: "session/new",
      params: { cwd: "/workspace", mcpServers: [] },
    })
    expect(result.result.sessionId).toBeDefined()
    expect(result.result.workspace).toBe("/workspace")
    expect(result.result.plan).toEqual({ entries: [] })
  })

  test("session/load returns current plan state", async () => {
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
    expect(loaded.result.workspace).toBe("/test")
    expect(loaded.result.plan).toEqual({ entries: [] })
  })

  test("session/load returns current plan state from persisted todos", async () => {
    const server = new ACPServer()
    const created = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const sessionId = created.result.sessionId

    await Boot.init(TEST_WORKSPACE)
    await Instance.provide({
      directory: TEST_WORKSPACE,
      fn: async () => {
        Todo.update({
          sessionID: sessionId,
          todos: [
            {
              content: "Bootstrap persisted plan state",
              status: "in_progress",
              priority: "high",
            },
            {
              content: "Cancelled todo is normalized",
              status: "cancelled",
              priority: "low",
            },
          ],
        })
      },
    })

    const reloadedServer = new ACPServer()
    const loaded = await reloadedServer.dispatch({
      jsonrpc: "2.0",
      id: "2",
      method: "session/load",
      params: { sessionId, cwd: TEST_WORKSPACE },
    })

    expect(loaded.result).toEqual({
      sessionId,
      workspace: TEST_WORKSPACE,
      plan: {
        entries: [
          {
            content: "Bootstrap persisted plan state",
            status: "in_progress",
            priority: "high",
          },
          {
            content: "Cancelled todo is normalized",
            status: "completed",
            priority: "low",
          },
        ],
      },
    })
  })

  test("session/load returns current plan state from persisted session workspace when cwd is overridden", async () => {
    const server = new ACPServer()
    const persistedWorkspace = "/tmp/persisted-bootstrap-workspace"
    const overrideWorkspace = "/tmp/override-bootstrap-workspace"

    const created = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: persistedWorkspace },
    })

    const sessionId = created.result.sessionId

    await Boot.init(persistedWorkspace)
    await Instance.provide({
      directory: persistedWorkspace,
      fn: async () => {
        Todo.update({
          sessionID: sessionId,
          todos: [
            {
              content: "Load from persisted workspace state",
              status: "in_progress",
              priority: "high",
            },
          ],
        })
      },
    })

    const reloadedServer = new ACPServer()
    const loaded = await reloadedServer.dispatch({
      jsonrpc: "2.0",
      id: "2",
      method: "session/load",
      params: { sessionId, cwd: overrideWorkspace },
    })

    expect(loaded.result).toEqual({
      sessionId,
      workspace: overrideWorkspace,
      plan: {
        entries: [
          {
            content: "Load from persisted workspace state",
            status: "in_progress",
            priority: "high",
          },
        ],
      },
    })
  })

  test("plan entries coexist additively with sessionId and workspace", async () => {
    const server = new ACPServer()

    const created = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    expect(created.result.sessionId).toBeDefined()
    expect(created.result.workspace).toBe(TEST_WORKSPACE)
    expect(created.result.plan.entries).toEqual([])

    await Boot.init(TEST_WORKSPACE)
    await Instance.provide({
      directory: TEST_WORKSPACE,
      fn: async () => {
        Todo.update({
          sessionID: created.result.sessionId,
          todos: [
            {
              content: "Persisted additive bootstrap entry",
              status: "pending",
              priority: "medium",
            },
          ],
        })
      },
    })

    const loaded = await server.dispatch({
      jsonrpc: "2.0",
      id: "2",
      method: "session/load",
      params: { sessionId: created.result.sessionId, cwd: TEST_WORKSPACE },
    })

    expect(loaded.result.sessionId).toBe(created.result.sessionId)
    expect(loaded.result.workspace).toBe(TEST_WORKSPACE)
    expect(loaded.result.plan).toEqual({
      entries: [
        {
          content: "Persisted additive bootstrap entry",
          status: "pending",
          priority: "medium",
        },
      ],
    })
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

    test("preserves trailing empty multiline lines for slash-only commands", () => {
      const server = new ACPServer()

      expect((server as any).resolvePromptInvocation("/init\n")).toEqual({
        type: "command",
        command: "init",
        arguments: "\n",
      })
    })

    test("preserves trailing empty multiline lines after same-line arguments", () => {
      const server = new ACPServer()

      expect((server as any).resolvePromptInvocation("/review HEAD~1\n")).toEqual({
        type: "command",
        command: "review",
        arguments: "HEAD~1\n",
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

    test("does not recognize non-leading slash text", () => {
      const server = new ACPServer()

      expect((server as any).resolvePromptInvocation("hello /init")).toEqual({
        type: "prompt",
        parts: [{ type: "text", text: "hello /init" }],
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

  test("session/prompt preserves active abort controller when overlapping turn is rejected", async () => {
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
    const originalCancel = SessionPrompt.cancel
    const originalExecuteAgentLoop = (server as any).executeAgentLoop
    const promptRelease = Promise.withResolvers<void>()
    let loopCalls = 0

    ;(server as any).executeAgentLoop = async (_session: unknown, _invocation: unknown, _providerMeta: unknown, requestId: string) => {
      loopCalls += 1
      if (requestId === "2") {
        await promptRelease.promise
        return
      }
      throw new Session.BusyError(sessionId as any)
    }
    SessionPrompt.cancel = async () => undefined as any

    try {
      const first = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId,
          prompt: "First",
          _meta: {
            model: "test-model",
            baseUrl: "http://localhost",
            apiKey: "test-key",
          },
        },
      })

      expect(first.result).toBeNull()
      await waitFor(() => loopCalls === 1)

      const activeController = (server as any).sessions.get(sessionId)?.abortController
      expect(activeController).toBeDefined()

      const second = await server.dispatch({
        jsonrpc: "2.0",
        id: "3",
        method: "session/prompt",
        params: {
          sessionId,
          prompt: "Second",
          _meta: {
            model: "test-model",
            baseUrl: "http://localhost",
            apiKey: "test-key",
          },
        },
      })

      expect(second.result).toBeNull()
      await waitFor(() =>
        notifications.some(
          (msg) => msg?.id === "3" && msg?.error?.message === `Session is busy: ${sessionId}`,
        ),
      )

      expect(loopCalls).toBe(1)
      expect((server as any).sessions.get(sessionId)?.abortController).toBe(activeController)

      const cancelled = await server.dispatch({
        jsonrpc: "2.0",
        id: "4",
        method: "session/cancel",
        params: { sessionId },
      })

      expect(cancelled.result.cancelled).toBe(true)
      expect(activeController.signal.aborted).toBe(true)

      promptRelease.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      promptRelease.resolve()
      ;(server as any).executeAgentLoop = originalExecuteAgentLoop
      SessionPrompt.cancel = originalCancel
    }
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

  test("session/prompt normalizes transcript-visible ACP status text touched by path display work", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "C:/repo" },
    })

    ;(server as any).executeAgentLoop = async () => {
      throw new Error("failed at c:\\repo\\src\\index.ts")
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
            text: "\n[Agent error: failed at /src/index.ts]\n",
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
            locations: [{ path: ".../workspace/README.md" }],
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

  test("session/prompt routes /init through SessionPrompt.command", async () => {
    const server = new ACPServer()

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const commandCalls: CommandInput[] = []
    const promptCalls: PromptInput[] = []
    const originalCommand = SessionPrompt.command
    const originalPrompt = SessionPrompt.prompt

    SessionPrompt.command = async (input) => {
      commandCalls.push(input)
      return {
        info: { id: MessageID.ascending() } as PromptResult["info"],
      } as PromptResult
    }
    SessionPrompt.prompt = async (input) => {
      promptCalls.push(input)
      return {
        info: { id: MessageID.ascending() } as PromptResult["info"],
        parts: input.parts,
      } as PromptResult
    }

    try {
      const result = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId: sess.result.sessionId,
          prompt: "/init",
          _meta: {
            model: "test-model",
            baseUrl: "http://localhost",
            apiKey: "test-key",
          },
        },
      })

      expect(result.result).toBeNull()
      await waitFor(() => commandCalls.length === 1)
      expect(commandCalls).toHaveLength(1)
      expect(promptCalls).toHaveLength(0)
      expect(commandCalls[0]?.command).toBe("init")
      expect(commandCalls[0]?.arguments).toBe("")
      expect(commandCalls[0]?.sessionID).toBe(sess.result.sessionId)
    } finally {
      SessionPrompt.command = originalCommand
      SessionPrompt.prompt = originalPrompt
    }
  })

  test("session/prompt keeps ordinary text on SessionPrompt.prompt", async () => {
    const server = new ACPServer()

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const commandCalls: CommandInput[] = []
    const promptCalls: PromptInput[] = []
    const originalCommand = SessionPrompt.command
    const originalPrompt = SessionPrompt.prompt

    SessionPrompt.command = async (input) => {
      commandCalls.push(input)
      return {
        info: { id: MessageID.ascending() } as PromptResult["info"],
      } as PromptResult
    }
    SessionPrompt.prompt = async (input) => {
      promptCalls.push(input)
      return {
        info: { id: MessageID.ascending() } as PromptResult["info"],
        parts: input.parts,
      } as PromptResult
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
      await waitFor(() => promptCalls.length === 1)
      expect(promptCalls).toHaveLength(1)
      expect(commandCalls).toHaveLength(0)
      expect(promptCalls[0]?.parts).toEqual([{ type: "text", text: "Hello!" }])
    } finally {
      SessionPrompt.command = originalCommand
      SessionPrompt.prompt = originalPrompt
    }
  })

  test("session/prompt surfaces unknown slash commands through ACP", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const originalCommand = SessionPrompt.command
    const originalPrompt = SessionPrompt.prompt

    SessionPrompt.command = async (input) => {
      throw new Error(`Command not found: "${input.command}"`)
    }
    SessionPrompt.prompt = async (input) => {
      return {
        info: { id: MessageID.ascending() } as PromptResult["info"],
        parts: input.parts,
      } as PromptResult
    }

    try {
      const result = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId: sess.result.sessionId,
          prompt: "/unknown",
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
          (msg) => msg?.id === "2" && msg?.result?.stopReason === "error",
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
              text: "\n[Agent error: Command not found: \"unknown\"]\n",
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
          error: "Command not found: \"unknown\"",
        },
      })
    } finally {
      SessionPrompt.command = originalCommand
      SessionPrompt.prompt = originalPrompt
    }
  })

  test("session/prompt preserves multiline slash arguments through SessionPrompt.command", async () => {
    const server = new ACPServer()

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const commandCalls: CommandInput[] = []
    const promptCalls: PromptInput[] = []
    const originalCommand = SessionPrompt.command
    const originalPrompt = SessionPrompt.prompt

    SessionPrompt.command = async (input) => {
      commandCalls.push(input)
      return {
        info: { id: MessageID.ascending() } as PromptResult["info"],
      } as PromptResult
    }
    SessionPrompt.prompt = async (input) => {
      promptCalls.push(input)
      return {
        info: { id: MessageID.ascending() } as PromptResult["info"],
        parts: input.parts,
      } as PromptResult
    }

    try {
      const result = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId: sess.result.sessionId,
          prompt: "/review HEAD~1\nfocus acp",
          _meta: {
            model: "test-model",
            baseUrl: "http://localhost",
            apiKey: "test-key",
          },
        },
      })

      expect(result.result).toBeNull()
      await waitFor(() => commandCalls.length === 1)
      expect(commandCalls).toHaveLength(1)
      expect(promptCalls).toHaveLength(0)
      expect(commandCalls[0]?.command).toBe("review")
      expect(commandCalls[0]?.arguments).toBe("HEAD~1\nfocus acp")
    } finally {
      SessionPrompt.command = originalCommand
      SessionPrompt.prompt = originalPrompt
    }
  })

  test("session/prompt slash execution preserves ACP chunk and end_turn completion semantics", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const originalCommand = SessionPrompt.command
    const originalPrompt = SessionPrompt.prompt

    SessionPrompt.command = async (input) => {
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()

      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: partID,
          messageID,
          sessionID: input.sessionID as any,
          type: "text",
        },
      })
      await Bus.publish(MessageV2.Event.PartDelta, {
        sessionID: input.sessionID as any,
        messageID,
        partID,
        delta: "Running init...",
      })

      return {
        info: { id: messageID } as PromptResult["info"],
      } as PromptResult
    }
    SessionPrompt.prompt = async (input) => {
      return {
        info: { id: MessageID.ascending() } as PromptResult["info"],
        parts: input.parts,
      } as PromptResult
    }

    try {
      const result = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "session/prompt",
        params: {
          sessionId: sess.result.sessionId,
          prompt: "/init",
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
          (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "agent_message_chunk",
        ) && notifications.some((msg) => msg?.id === "2" && msg?.result?.stopReason === "end_turn"),
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
              text: "Running init...",
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
          stopReason: "end_turn",
        },
      })

      const chunkIndex = notifications.findIndex(
        (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "agent_message_chunk",
      )
      const responseIndex = notifications.findIndex(
        (msg) => msg?.id === "2" && msg?.result?.stopReason === "end_turn",
      )

      expect(chunkIndex).toBeGreaterThanOrEqual(0)
      expect(responseIndex).toBeGreaterThanOrEqual(0)
      expect(chunkIndex).toBeLessThan(responseIndex)
    } finally {
      SessionPrompt.command = originalCommand
      SessionPrompt.prompt = originalPrompt
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

  test("emits plan updates during live prompts with no agent gating", async () => {
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
            content: "Canonical live plan signal",
            status: "in_progress",
            priority: "high",
          },
        ],
      })

      return {
        info: {
          role: "assistant",
          agent: "explore",
        },
      }
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
                content: "Canonical live plan signal",
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

      expect(notifications).toContainEqual({
        jsonrpc: "2.0",
        id: "2",
        result: {
          stopReason: "end_turn",
        },
      })
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
    }
  })

  test("emits empty plan updates when todos become empty", async () => {
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
            content: "Transient plan item",
            status: "pending",
            priority: "medium",
          },
        ],
      })

      Todo.update({
        sessionID: input.sessionID as any,
        todos: [],
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
      await waitFor(() => planUpdates(notifications).length === 2)

      expect(planUpdates(notifications)).toEqual([
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "plan",
              entries: [
                {
                  content: "Transient plan item",
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
        },
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "plan",
              entries: [],
            },
            _meta: {
              source: "mainagent",
              agent_name: "default",
              workspace: TEST_WORKSPACE,
            },
          },
        },
      ])
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
    }
  })

  test("child session todo activity does not overwrite parent session plan updates", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const parent = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: TEST_WORKSPACE },
    })

    const parentSessionId = parent.result.sessionId
    let childSessionId: string | undefined
    const originalPrompt = (SessionPrompt as any).prompt
    ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
      Todo.update({
        sessionID: input.sessionID as any,
        todos: [
          {
            content: "Parent plan remains canonical",
            status: "in_progress",
            priority: "high",
          },
        ],
      })

      const child = await Session.createNext({
        directory: TEST_WORKSPACE,
        parentID: input.sessionID as any,
      })
      childSessionId = child.id

      Todo.update({
        sessionID: child.id,
        todos: [
          {
            content: "Child plan should stay isolated",
            status: "pending",
            priority: "low",
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
          sessionId: parentSessionId,
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
          (msg) => msg?.jsonrpc === "2.0" && msg?.id === "2" && msg?.result?.stopReason === "end_turn",
        ),
      )

      expect(childSessionId).toBeDefined()
      expect(
        planUpdates(notifications).filter((msg) => msg?.params?.sessionId === childSessionId),
      ).toEqual([])

      expect(planUpdates(notifications)).toEqual([
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: parentSessionId,
            update: {
              sessionUpdate: "plan",
              entries: [
                {
                  content: "Parent plan remains canonical",
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
        },
      ])
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
    }
  })

  test("todo structured tool update preserves legacy string output", async () => {
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
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: input.sessionID as any,
          type: "tool",
          callID: "todo-structured-call",
          tool: "todowrite",
          state: {
            status: "completed",
            input: {
              todos: [
                {
                  content: "Project structured todo payloads",
                  status: "in_progress",
                  priority: "high",
                },
              ],
            },
            metadata: {
              todos: [
                {
                  content: "Project structured todo payloads",
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
            output: [
              "1 todo",
              "Current focus: Project structured todo payloads",
              "In progress: 1",
              "Pending: 0",
              "Completed: 0",
              "Cancelled: 0",
            ].join("\n"),
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
          (msg) =>
            msg?.method === "session/update" &&
            msg?.params?.update?.sessionUpdate === "tool_call_update" &&
            msg?.params?.update?.toolCallId === "todo-structured-call",
        ),
      )

      expect(notifications).toContainEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "todo-structured-call",
            status: "completed",
            rawOutput: [
              "1 todo",
              "Current focus: Project structured todo payloads",
              "In progress: 1",
              "Pending: 0",
              "Completed: 0",
              "Cancelled: 0",
            ].join("\n"),
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: [
                    "1 todo",
                    "Current focus: Project structured todo payloads",
                    "In progress: 1",
                    "Pending: 0",
                    "Completed: 0",
                    "Cancelled: 0",
                  ].join("\n"),
                },
              },
            ],
            structured: {
              todos: [
                {
                  content: "Project structured todo payloads",
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

  test("session/prompt keeps tool_call_update locations normalized while preserving internal raw error paths", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "C:/repo" },
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
          tool: "read",
          state: {
            status: "error",
            input: { filePath: "c:\\repo\\src\\index.ts" },
            error: "failed to read c:\\repo\\src\\index.ts",
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

      const update = notifications.find(
        (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "tool_call_update",
      )

      expect(update.params.update.rawOutput).toEqual({
        error: "failed to read c:\\repo\\src\\index.ts",
      })
      expect(update.params.update.locations).toEqual([{ path: "src/index.ts" }])
      expect(update.params.update.content).toEqual([
        {
          type: "content",
          content: {
            type: "text",
            text: "failed to read /src/index.ts",
          },
        },
      ])
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
    }
  })

  test("task structured tool update includes session and resumable fields", async () => {
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
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: input.sessionID as any,
          type: "tool",
          callID: "task-structured-call",
          tool: "task",
          state: {
            status: "completed",
            input: {
              description: "Review ACP output",
              prompt: "Inspect task output",
              subagent_type: "general",
            },
            metadata: {
              sessionId: "child-session-123",
              model: {
                providerID: "reaslab",
                modelID: "gpt-5.4",
              },
              resultText: "Task finished successfully",
              resultEmpty: false,
              taskID: "child-session-123",
              resumable: {
                task_id: "child-session-123",
              },
            },
            output: [
              "task_id: child-session-123 (for resuming to continue this task if needed)",
              "",
              "Task finished successfully",
            ].join("\n"),
            time: { start: Date.now(), end: Date.now() },
          },
        },
      })

      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: input.sessionID as any,
          type: "tool",
          callID: "task-empty-structured-call",
          tool: "task",
          state: {
            status: "completed",
            input: {
              description: "Resume ACP task",
              prompt: "Inspect empty task output",
              subagent_type: "general",
              task_id: "child-session-empty",
            },
            metadata: {
              sessionId: "child-session-empty",
              model: {
                providerID: "reaslab",
                modelID: "gpt-5.4",
              },
              resultText: "",
              resultEmpty: true,
              taskID: "child-session-empty",
              resumable: {
                task_id: "child-session-empty",
              },
            },
            output: [
              "task_id: child-session-empty (for resuming to continue this task if needed)",
              "",
              "",
            ].join("\n"),
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
          (msg) =>
            msg?.method === "session/update" &&
            msg?.params?.update?.sessionUpdate === "tool_call_update" &&
            String(msg?.params?.update?.toolCallId || "").includes("task-"),
        ).length === 2,
      )

      expect(notifications).toContainEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "task-structured-call",
            status: "completed",
            rawOutput: [
              "task_id: child-session-123 (for resuming to continue this task if needed)",
              "",
              "Task finished successfully",
            ].join("\n"),
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: [
                    "task_id: child-session-123 (for resuming to continue this task if needed)",
                    "",
                    "Task finished successfully",
                  ].join("\n"),
                },
              },
            ],
            structured: {
              sessionId: "child-session-123",
              model: {
                providerID: "reaslab",
                modelID: "gpt-5.4",
              },
              resultText: "Task finished successfully",
              resultEmpty: false,
              taskID: "child-session-123",
              resumable: {
                task_id: "child-session-123",
              },
            },
          },
          _meta: {
            source: "mainagent",
            agent_name: "default",
            workspace: TEST_WORKSPACE,
          },
        },
      })

      expect(notifications).toContainEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "task-empty-structured-call",
            status: "completed",
            rawOutput: [
              "task_id: child-session-empty (for resuming to continue this task if needed)",
              "",
              "",
            ].join("\n"),
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: [
                    "task_id: child-session-empty (for resuming to continue this task if needed)",
                    "",
                    "",
                  ].join("\n"),
                },
              },
            ],
            structured: {
              sessionId: "child-session-empty",
              model: {
                providerID: "reaslab",
                modelID: "gpt-5.4",
              },
              resultText: "",
              resultEmpty: true,
              taskID: "child-session-empty",
              resumable: {
                task_id: "child-session-empty",
              },
            },
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

  test("workspace-sync does not duplicate file diffs already emitted by tool_call_update", async () => {
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
    const originalSnapshot = WorkspaceDiffer.prototype.snapshot
    const originalComputeDiffs = WorkspaceDiffer.prototype.computeDiffs

    WorkspaceDiffer.prototype.snapshot = async () => undefined
    WorkspaceDiffer.prototype.computeDiffs = async () => [
      {
        absolutePath: `${TEST_WORKSPACE}/README.md`,
        oldText: "before",
        newText: "after",
      },
      {
        absolutePath: `${TEST_WORKSPACE}/notes.txt`,
        oldText: "alpha",
        newText: "beta",
      },
    ]

    ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: input.sessionID as any,
          type: "tool",
          callID: "write-call",
          tool: "write",
          state: {
            status: "completed",
            input: { filePath: `${TEST_WORKSPACE}/README.md` },
            metadata: {},
            title: "README.md",
            output: `saved\x00DIFF\x00${JSON.stringify({
              diff: {
                type: "diff",
                path: `${TEST_WORKSPACE}/README.md`,
                oldText: "before",
                newText: "after",
              },
            })}`,
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
          (msg) => msg?.id === "2" && msg?.result?.stopReason === "end_turn",
        ),
      )

      const workspaceSyncCalls = notifications.filter(
        (msg) =>
          msg?.method === "session/update" &&
          msg?.params?.update?.sessionUpdate === "tool_call" &&
          msg?.params?.update?.title === "workspace-sync: notes.txt",
      )
      const workspaceSyncUpdates = notifications.filter(
        (msg) =>
          msg?.method === "session/update" &&
          msg?.params?.update?.sessionUpdate === "tool_call_update" &&
          String(msg?.params?.update?.toolCallId || "").startsWith("ws-sync-"),
      )

      expect(workspaceSyncCalls).toHaveLength(1)
      expect(workspaceSyncUpdates).toHaveLength(1)
      expect(workspaceSyncCalls[0]?.params?.update?.locations).toEqual([{ path: "notes.txt" }])
      expect(workspaceSyncUpdates[0]?.params?.update?.locations).toEqual([{ path: "notes.txt" }])
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
      WorkspaceDiffer.prototype.snapshot = originalSnapshot
      WorkspaceDiffer.prototype.computeDiffs = originalComputeDiffs
    }
  })

  test("workspace-sync does not duplicate file diffs when tool emits relative diff paths", async () => {
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
    const originalSnapshot = WorkspaceDiffer.prototype.snapshot
    const originalComputeDiffs = WorkspaceDiffer.prototype.computeDiffs

    WorkspaceDiffer.prototype.snapshot = async () => undefined
    WorkspaceDiffer.prototype.computeDiffs = async () => [
      {
        absolutePath: `${TEST_WORKSPACE}/README.md`,
        oldText: "before",
        newText: "after",
      },
    ]

    ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: input.sessionID as any,
          type: "tool",
          callID: "write-call",
          tool: "write",
          state: {
            status: "completed",
            input: { filePath: "README.md" },
            metadata: {},
            title: "README.md",
            output: `saved\x00DIFF\x00${JSON.stringify({
              diff: {
                type: "diff",
                path: "README.md",
                oldText: "before",
                newText: "after",
              },
            })}`,
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
          (msg) => msg?.id === "2" && msg?.result?.stopReason === "end_turn",
        ),
      )

      const workspaceSyncCalls = notifications.filter(
        (msg) =>
          msg?.method === "session/update" &&
          msg?.params?.update?.sessionUpdate === "tool_call" &&
          String(msg?.params?.update?.toolCallId || "").startsWith("ws-sync-"),
      )
      const workspaceSyncUpdates = notifications.filter(
        (msg) =>
          msg?.method === "session/update" &&
          msg?.params?.update?.sessionUpdate === "tool_call_update" &&
          String(msg?.params?.update?.toolCallId || "").startsWith("ws-sync-"),
      )

      expect(workspaceSyncCalls).toHaveLength(0)
      expect(workspaceSyncUpdates).toHaveLength(0)
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
      WorkspaceDiffer.prototype.snapshot = originalSnapshot
      WorkspaceDiffer.prototype.computeDiffs = originalComputeDiffs
    }
  })

  test("workspace-sync emits normalized labels and locations for display surfaces", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "C:/repo" },
    })

    const originalPrompt = (SessionPrompt as any).prompt
    const originalComputeDiffs = WorkspaceDiffer.prototype.computeDiffs
    ;(SessionPrompt as any).prompt = async () => undefined
    WorkspaceDiffer.prototype.computeDiffs = async () => [
      {
        absolutePath: "c:\\repo\\notes.txt",
        oldText: "alpha",
        newText: "beta",
      },
    ]

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
          (msg) => msg?.method === "session/update" && msg?.params?.update?.title === "workspace-sync: notes.txt",
        ),
      )

      const toolCall = notifications.find(
        (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "tool_call",
      )
      const toolUpdate = notifications.find(
        (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "tool_call_update",
      )

      expect(toolCall.params.update.rawInput).toEqual({ file: "notes.txt" })
      expect(toolCall.params.update.title).toBe("workspace-sync: notes.txt")
      expect(toolCall.params.update.locations).toEqual([{ path: "notes.txt" }])
      expect(toolUpdate.params.update.rawOutput).toBe("File synced by external tool")
      expect(toolUpdate.params.update.locations).toEqual([{ path: "notes.txt" }])
      expect(toolUpdate.params.update.content).toEqual([
        {
          type: "diff",
          path: "notes.txt",
          oldText: "alpha",
          newText: "beta",
        },
      ])
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
      WorkspaceDiffer.prototype.computeDiffs = originalComputeDiffs
    }
  })

  test("workspace-sync diff dedupe does not merge case-variant paths on case-sensitive platforms", async () => {
    const server = new ACPServer()
    const notifications: any[] = []
    server.onNotification = (msg) => notifications.push(msg)

    const sess = await server.dispatch({
      jsonrpc: "2.0",
      id: "1",
      method: "session/new",
      params: { cwd: "/tmp/case-sensitive-workspace" },
    })

    const sessionId = sess.result.sessionId
    const originalPrompt = (SessionPrompt as any).prompt
    const originalSnapshot = WorkspaceDiffer.prototype.snapshot
    const originalComputeDiffs = WorkspaceDiffer.prototype.computeDiffs

    WorkspaceDiffer.prototype.snapshot = async () => undefined
    WorkspaceDiffer.prototype.computeDiffs = async () => [
      {
        absolutePath: "/tmp/case-sensitive-workspace/readme.md",
        oldText: "alpha",
        newText: "beta",
      },
    ]

    ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID: input.sessionID as any,
          type: "tool",
          callID: "write-call",
          tool: "write",
          state: {
            status: "completed",
            input: { filePath: "/tmp/case-sensitive-workspace/README.md" },
            metadata: {},
            title: "README.md",
            output: `saved\x00DIFF\x00${JSON.stringify({
              diff: {
                type: "diff",
                path: "/tmp/case-sensitive-workspace/README.md",
                oldText: "before",
                newText: "after",
              },
            })}`,
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
          (msg) => msg?.id === "2" && msg?.result?.stopReason === "end_turn",
        ),
      )

      const workspaceSyncCalls = notifications.filter(
        (msg) =>
          msg?.method === "session/update" &&
          msg?.params?.update?.sessionUpdate === "tool_call" &&
          String(msg?.params?.update?.toolCallId || "").startsWith("ws-sync-"),
      )
      const workspaceSyncUpdates = notifications.filter(
        (msg) =>
          msg?.method === "session/update" &&
          msg?.params?.update?.sessionUpdate === "tool_call_update" &&
          String(msg?.params?.update?.toolCallId || "").startsWith("ws-sync-"),
      )

      expect(workspaceSyncCalls).toHaveLength(1)
      expect(workspaceSyncUpdates).toHaveLength(1)
      expect(workspaceSyncCalls[0]?.params?.update?.locations).toEqual([{ path: "readme.md" }])
      expect(workspaceSyncUpdates[0]?.params?.update?.locations).toEqual([{ path: "readme.md" }])
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
      WorkspaceDiffer.prototype.snapshot = originalSnapshot
      WorkspaceDiffer.prototype.computeDiffs = originalComputeDiffs
    }
  })
})

function planUpdates(notifications: any[]) {
  return notifications.filter(
    (msg) => msg?.method === "session/update" && msg?.params?.update?.sessionUpdate === "plan",
  )
}

async function waitFor(check: () => boolean, timeout = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for condition")
}
