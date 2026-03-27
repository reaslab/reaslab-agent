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
})
