import { describe, expect, test } from "bun:test"
import { createACPHarness } from "../helpers/acp-harness"

describe("ACP harness contract", () => {
  test("initialize -> authenticate -> session/new returns the bootstrap shape", async () => {
    const harness = createACPHarness()

    const result = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-harness",
    })

    expect(result).toHaveProperty("initializeResult")
    expect(result).toHaveProperty("authenticateResult")
    expect(result).toHaveProperty("sessionResult")
    expect(result).toHaveProperty("notifications")
    expect(result).toHaveProperty("errors")
    expect(result).toHaveProperty("timeline")
    expect(result).toHaveProperty("model")
    expect(result).toHaveProperty("scenario")
    expect(result.initializeResult.protocolVersion).toBeDefined()
    expect(result.authenticateResult.authenticated).toBe(true)
    expect(result.sessionResult.sessionId).toBeDefined()
    expect(Array.isArray(result.notifications)).toBe(true)
    expect(Array.isArray(result.errors)).toBe(true)
    expect(result.timeline.startedAt).toBeGreaterThan(0)
    expect(result.model).toBeNull()
    expect(result.scenario).toBe("session-bootstrap")
  })

  test("repeated start calls return per-run notifications arrays", async () => {
    const harness = createACPHarness()

    const first = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-harness",
    })
    first.notifications.push({ method: "test/notification" })

    const second = await harness.start({
      cwd: "C:/tmp/reaslab-agent/acp-contract-harness",
    })

    expect(second.notifications).toEqual([])
    expect(second.notifications).not.toBe(first.notifications)
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
})
