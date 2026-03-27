import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/protocol"
import { ACPServer } from "../../src/acp/server"
import { Boot } from "../../src/boot"
import { Instance } from "../../src/project/instance"
import { Todo } from "../../src/session/todo"
import { createACPHarness } from "../helpers/acp-harness"

describe("ACP harness contract", () => {
  test("initialize exposes reaslab-uni bootstrap capabilities", async () => {
    const harness = createACPHarness()

    const result = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-harness",
    })

    expect(result.initializeResult.protocolVersion).toBe("0.1.0")
    expect(result.initializeResult.capabilities).toEqual({
      streaming: true,
      tools: true,
      skills: true,
    })
    expect(result.initializeResult.serverInfo).toEqual({
      name: "reaslab-agent",
      version: "0.1.0",
    })
    expect(result.authenticateResult.authenticated).toBe(true)
  })

  test("session/new returns sessionId workspace and plan entries", async () => {
    const harness = createACPHarness()

    const result = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-harness",
    })

    expect(typeof result.sessionResult.sessionId).toBe("string")
    expect(result.sessionResult.workspace).toBe("C:/tmp/reaslab-agent/acp-contract-harness")
    expect(result.sessionResult.plan).toEqual({
      entries: [],
    })
  })

  test("session/load exposes bootstrap todos only under result.plan.entries", async () => {
    const harness = createACPHarness()
    const cwd = "C:/tmp/reaslab-agent/acp-contract-load"

    const started = await harness.start({ cwd })

    await Boot.init(cwd)
    await Instance.provide({
      directory: cwd,
      fn: async () => {
        Todo.update({
          sessionID: started.sessionResult.sessionId,
          todos: [
            {
              content: "Bootstrap contract entry",
              status: "pending",
              priority: "medium",
            },
          ],
        })
      },
    })

    const loaded = await harness.loadSession({
      sessionId: started.sessionResult.sessionId,
      cwd,
    })

    expect(loaded.sessionResult.sessionId).toBe(started.sessionResult.sessionId)
    expect(loaded.sessionResult.workspace).toBe(cwd)
    expect(loaded.sessionResult.plan).toBeDefined()
    expect(Array.isArray(loaded.sessionResult.plan.entries)).toBe(true)
    expect(loaded.sessionResult.plan.entries).toEqual([
      {
        content: "Bootstrap contract entry",
        status: "pending",
        priority: "medium",
      },
    ])
    expect((loaded.sessionResult as any).entries).toBeUndefined()
  })

  test("runPrompt records prompt completion lifecycle for errored prompt execution", async () => {
    const harness = createACPHarness()

    const started = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-prompt-lifecycle",
    })

    const result = await harness.runPrompt({
      sessionId: started.sessionResult.sessionId,
      prompt: "Say hello and stop.",
      _meta: {
        model: "test-model",
        baseUrl: "http://127.0.0.1:1",
        apiKey: "test-api-key",
      },
      timeoutMs: 5000,
    })

    expect(result).toHaveProperty("promptImmediateResult")
    expect(result).toHaveProperty("notifications")
    expect(result).toHaveProperty("errors")
    expect(result).toHaveProperty("aggregatedText")
    expect(result).toHaveProperty("aggregatedThoughts")
    expect(result).toHaveProperty("toolCalls")
    expect(result).toHaveProperty("toolCallUpdates")
    expect(result).toHaveProperty("planUpdates")
    expect(result).toHaveProperty("finalResponse")
    expect(result).toHaveProperty("model")
    expect(result).toHaveProperty("scenario")
    expect(result).toHaveProperty("timeline")
    expect(result).toHaveProperty("completion")

    expect(result.promptImmediateResult).toBeNull()
    expect(Array.isArray(result.notifications)).toBe(true)
    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.toolCalls)).toBe(true)
    expect(Array.isArray(result.toolCallUpdates)).toBe(true)
    expect(Array.isArray(result.planUpdates)).toBe(true)
    expect(typeof result.aggregatedText).toBe("string")
    expect(typeof result.aggregatedThoughts).toBe("string")
    expect(result.model).toBe("test-model")
    expect(result.scenario).toBe("prompt-lifecycle")
    expect(result.timeline.startedAt).toBeGreaterThan(0)
    expect(result.completion.state).toBe("errored")
    expect(result.completion.classification).toBe("runtime_failure")
    expect(result.finalResponse).toBeDefined()
    expect(result.finalResponse?.result).toMatchObject({
      stopReason: "error",
    })
  })

  test("runPrompt times out even if session/cancel never resolves", async () => {
    const server = new ACPServer()
    let cancelRequests = 0
    const harness = createACPHarness({
      server,
      dispatch(request) {
        switch (request.method) {
          case "initialize":
            return Promise.resolve({ result: { protocolVersion: "0.1.0" } })
          case "authenticate":
            return Promise.resolve({ result: { authenticated: true } })
          case "session/new":
            return Promise.resolve({
              result: {
                sessionId: "ses-timeout",
                workspace: "C:/tmp/reaslab-agent/acp-prompt-lifecycle",
                plan: { entries: [] },
              },
            })
          case "session/prompt":
            return Promise.resolve({ result: null })
          case "session/cancel":
            cancelRequests += 1
            return new Promise(() => {})
          default:
            return Promise.reject(new Error(`Unexpected method: ${request.method}`))
        }
      },
    })

    const started = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-prompt-lifecycle",
    })

    const result = await Promise.race([
      harness.runPrompt({
        sessionId: started.sessionResult.sessionId,
        prompt: "wait forever",
        _meta: {
          model: "test-model",
          baseUrl: "http://127.0.0.1:1",
          apiKey: "test-api-key",
        },
        timeoutMs: 20,
      }),
      new Promise<"hung">((resolve) => {
        setTimeout(() => resolve("hung"), 250)
      }),
    ])

    expect(result).not.toBe("hung")
    expect(result).toMatchObject({
      finalResponse: null,
      completion: {
        state: "timed_out",
        classification: "runtime_failure",
      },
    })
    expect(cancelRequests).toBe(1)
  })

  test("runPrompt leaves completion classification empty for successful completions", async () => {
    const server = new ACPServer()
    const harness = createACPHarness({
      server,
      dispatch(request) {
        switch (request.method) {
          case "initialize":
            return Promise.resolve({ result: { protocolVersion: "0.1.0" } })
          case "authenticate":
            return Promise.resolve({ result: { authenticated: true } })
          case "session/new":
            return Promise.resolve({
              result: {
                sessionId: "ses-success",
                workspace: "C:/tmp/reaslab-agent/acp-prompt-lifecycle",
                plan: { entries: [] },
              },
            })
          case "session/prompt":
            setTimeout(() => {
              server.onNotification?.({
                jsonrpc: "2.0",
                id: request.id,
                result: { stopReason: "end_turn" },
              })
            }, 0)
            return Promise.resolve({ result: null })
          default:
            return Promise.reject(new Error(`Unexpected method: ${request.method}`))
        }
      },
    })

    const started = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-prompt-lifecycle",
    })

    const result = await harness.runPrompt({
      sessionId: started.sessionResult.sessionId,
      prompt: "say hello",
      _meta: {
        model: "test-model",
        baseUrl: "http://127.0.0.1:1",
        apiKey: "test-api-key",
      },
      timeoutMs: 100,
    })

    expect(result.completion.state).toBe("completed")
    expect(result.completion.classification).toBeNull()
    expect(result.finalResponse?.result).toMatchObject({
      stopReason: "end_turn",
    })
  })

  test("deterministic notifications preserve plan updates under sessionUpdate plan with entries", async () => {
    const harness = createACPHarness()

    const started = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-deterministic-plan",
    })

    const result = await harness.runDeterministicPrompt({
      sessionId: started.sessionResult.sessionId,
      model: "test-model",
      notifications: [
        ACP.planUpdate(started.sessionResult.sessionId, [
          {
            content: "Lock ACP contract payload",
            priority: "high",
            status: "in_progress",
          },
        ]),
      ],
    })

    expect(result.planUpdates).toHaveLength(1)
    expect(result.planUpdates[0]?.params?.update).toEqual({
      sessionUpdate: "plan",
      entries: [
        {
          content: "Lock ACP contract payload",
          priority: "high",
          status: "in_progress",
        },
      ],
    })
  })

  test("deterministic notifications keep stable toolCallId values across tool lifecycle", async () => {
    const harness = createACPHarness()

    const started = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-deterministic-tool",
    })

    const toolCallId = "tool-call-42"
    const result = await harness.runDeterministicPrompt({
      sessionId: started.sessionResult.sessionId,
      model: "test-model",
      notifications: [
        ACP.toolCall(
          started.sessionResult.sessionId,
          toolCallId,
          "read",
          { filePath: "C:/tmp/reaslab-agent/acp-contract-deterministic-tool/src/index.ts" },
          "C:/tmp/reaslab-agent/acp-contract-deterministic-tool",
        ),
        ACP.toolCallUpdate(
          started.sessionResult.sessionId,
          toolCallId,
          "completed",
          "ok",
          undefined,
          { workspace: "C:/tmp/reaslab-agent/acp-contract-deterministic-tool" },
          { path: "C:/tmp/reaslab-agent/acp-contract-deterministic-tool/src/index.ts" },
        ),
      ],
    })

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCallUpdates).toHaveLength(1)
    expect(result.toolCalls[0]?.params?.update?.toolCallId).toBe(toolCallId)
    expect(result.toolCallUpdates[0]?.params?.update?.toolCallId).toBe(toolCallId)
  })

  test("busy-session and invalid-metadata prompt flows classify runtime failures deterministically", async () => {
    const busyServer = new ACPServer()
    const busyHarness = createACPHarness({
      server: busyServer,
      dispatch(request) {
        switch (request.method) {
          case "initialize":
            return Promise.resolve({ result: { protocolVersion: "0.1.0" } })
          case "authenticate":
            return Promise.resolve({ result: { authenticated: true } })
          case "session/new":
            return Promise.resolve({
              result: {
                sessionId: "ses-busy",
                workspace: "C:/tmp/reaslab-agent/acp-contract-errors",
                plan: { entries: [] },
              },
            })
          case "session/prompt":
            setTimeout(() => {
              busyServer.onNotification?.(ACP.error(request.id ?? null, -32603, "Session is busy: ses-busy"))
            }, 0)
            return Promise.resolve({ result: null })
          default:
            return Promise.reject(new Error(`Unexpected method: ${request.method}`))
        }
      },
    })

    const busyStarted = await busyHarness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-errors",
    })

    const busyResult = await busyHarness.runPrompt({
      sessionId: busyStarted.sessionResult.sessionId,
      prompt: "deterministic busy prompt",
      _meta: {
        model: "test-model",
        baseUrl: "http://127.0.0.1:1",
        apiKey: "test-api-key",
      },
      timeoutMs: 100,
    })

    expect(busyResult.completion).toMatchObject({
      state: "errored",
      classification: "runtime_failure",
    })

    const invalidHarness = createACPHarness({
      dispatch(request) {
        switch (request.method) {
          case "initialize":
            return Promise.resolve({ result: { protocolVersion: "0.1.0" } })
          case "authenticate":
            return Promise.resolve({ result: { authenticated: true } })
          case "session/new":
            return Promise.resolve({
              result: {
                sessionId: "ses-invalid-meta",
                workspace: "C:/tmp/reaslab-agent/acp-contract-errors",
                plan: { entries: [] },
              },
            })
          case "session/prompt":
            return Promise.resolve(ACP.error(request.id ?? null, -32603, "_meta must include model, baseUrl, and apiKey"))
          default:
            return Promise.reject(new Error(`Unexpected method: ${request.method}`))
        }
      },
    })

    const invalidStarted = await invalidHarness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-errors",
    })

    const invalidResult = await invalidHarness.runPrompt({
      sessionId: invalidStarted.sessionResult.sessionId,
      prompt: "deterministic invalid metadata prompt",
      _meta: {},
      timeoutMs: 100,
    })

    expect(invalidResult.completion).toMatchObject({
      state: "errored",
      classification: "runtime_failure",
    })
  })

  test("prompt result aggregation ignores unrelated session and request notifications", async () => {
    const server = new ACPServer()
    const harness = createACPHarness({
      server,
      dispatch(request) {
        switch (request.method) {
          case "initialize":
            return Promise.resolve({ result: { protocolVersion: "0.1.0" } })
          case "authenticate":
            return Promise.resolve({ result: { authenticated: true } })
          case "session/new":
            return Promise.resolve({
              result: {
                sessionId: "ses-scoped",
                workspace: "C:/tmp/reaslab-agent/acp-contract-scoped",
                plan: { entries: [] },
              },
            })
          case "session/prompt":
            setTimeout(() => {
              server.onNotification?.(ACP.messageChunk("ses-other", "ignore-this"))
              server.onNotification?.(ACP.planUpdate("ses-other", [
                {
                  content: "ignore-other-plan",
                  priority: "low",
                  status: "pending",
                },
              ]))
              server.onNotification?.(ACP.error("prompt-other", -32603, "ignore-other-error"))
              server.onNotification?.(ACP.messageChunk("ses-scoped", "kept-text"))
              server.onNotification?.(ACP.planUpdate("ses-scoped", [
                {
                  content: "kept-plan",
                  priority: "high",
                  status: "in_progress",
                },
              ]))
              server.onNotification?.(ACP.response(request.id ?? null, { stopReason: "end_turn" }))
            }, 0)
            return Promise.resolve({ result: null })
          default:
            return Promise.reject(new Error(`Unexpected method: ${request.method}`))
        }
      },
    })

    const started = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-scoped",
    })

    const result = await harness.runPrompt({
      sessionId: started.sessionResult.sessionId,
      prompt: "deterministic scoped prompt",
      _meta: {
        model: "test-model",
        baseUrl: "http://127.0.0.1:1",
        apiKey: "test-api-key",
      },
      timeoutMs: 100,
    })

    expect(result.aggregatedText).toBe("kept-text")
    expect(result.planUpdates).toHaveLength(1)
    expect(result.planUpdates[0]?.params?.update?.entries).toEqual([
      {
        content: "kept-plan",
        priority: "high",
        status: "in_progress",
      },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.finalResponse?.id).toBeDefined()
    expect(result.finalResponse?.id).not.toBe("prompt-other")
  })
})
