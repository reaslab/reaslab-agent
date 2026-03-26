import { describe, test, expect, beforeEach } from "bun:test"
import { generateText } from "ai"
import { Provider } from "../../src/provider/provider"

describe("Provider.fromMeta", () => {
  beforeEach(() => {
    Provider.clearCache()
  })

  test("creates LanguageModelV2 from meta", () => {
    const model = Provider.fromMeta({
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-key",
    })
    expect(model).toBeDefined()
    expect(model.modelId).toBe("gpt-4o")
  })

  test("handles reasoningEffort option", () => {
    const model = Provider.fromMeta({
      model: "claude-sonnet-4-5",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      reasoningEffort: "high",
    })
    expect(model).toBeDefined()
  })

  test("throws on missing required fields", () => {
    expect(() => Provider.fromMeta({ model: "", baseUrl: "", apiKey: "" })).toThrow()
  })

  test("caches models with same config", () => {
    const meta = {
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-key",
    }
    const model1 = Provider.fromMeta(meta)
    const model2 = Provider.fromMeta(meta)
    expect(model1).toBe(model2) // Same reference
  })

  test("modelFromMeta creates MinimalModel", () => {
    const model = Provider.modelFromMeta({
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    })
    expect(model.id).toBe("gpt-4o")
    expect(model.providerID).toBe("reaslab")
    expect(model.api.id).toBe("gpt-4o")
  })

  test("uses max_completion_tokens instead of max_tokens for gpt-5 compatible models", async () => {
    let requestBody: any
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"))
      return new Response(
        JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion",
          created: 1,
          model: "gpt-5.4",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "hello",
              },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }

    try {
      const model = Provider.fromMeta({
        model: "gpt-5.4",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test-key",
      })

      await generateText({
        model,
        prompt: "Say hello",
        maxOutputTokens: 123,
        maxRetries: 0,
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(requestBody.max_completion_tokens).toBe(123)
    expect("max_tokens" in requestBody).toBe(false)
  })
})
