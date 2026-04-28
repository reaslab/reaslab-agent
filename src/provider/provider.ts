import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"
import { createHash } from "crypto"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { ModelID, ProviderID } from "./schema"

export interface ProviderMeta {
  model: string
  baseUrl: string
  apiKey: string
  reasoningEffort?: string
  maxTokens?: number
}

/** Minimal Model type — compatible with system.ts and processor.ts */
export interface MinimalModel {
  id: string
  providerID: string
  api: { id: string }
  capabilities: Record<string, boolean>
}

const cache = new Map<string, LanguageModel>()

export namespace Provider {
  function wrapSSE(res: Response) {
    if (!res.body) return res
    if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const reader = res.body.getReader()
    let buffer = ""
    let normalized = false

    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        const part = await reader.read()
        if (part.done) {
          if (buffer.length > 0) {
            ctrl.enqueue(encoder.encode(normalizeSSE(buffer)))
            buffer = ""
          }
          ctrl.close()
          return
        }

        buffer += decoder.decode(part.value, { stream: true })
        const next = normalizeSSE(buffer)
        if (!next) return
        normalized = true
        ctrl.enqueue(encoder.encode(next))
        buffer = ""
      },
      async cancel(reason) {
        await reader.cancel(reason)
      },
    })

    if (!normalized && !buffer) {
      return new Response(body, {
        headers: new Headers(res.headers),
        status: res.status,
        statusText: res.statusText,
      })
    }

    return new Response(body, {
      headers: new Headers(res.headers),
      status: res.status,
      statusText: res.statusText,
    })
  }

  function normalizeSSE(input: string) {
    if (!input.includes("\ndata: ") || input.includes("\n\ndata: ")) return input
    return input.replace(/\r?\ndata: /g, "\n\ndata: ")
  }

  export type Meta = ProviderMeta
  export type Model = MinimalModel

  export function fromMeta(meta: ProviderMeta): LanguageModel {
    if (!meta.model || !meta.baseUrl || !meta.apiKey) {
      throw new Error("Provider.fromMeta: model, baseUrl, and apiKey are required")
    }

    const keyHash = createHash("sha256").update(meta.apiKey).digest("hex").slice(0, 16)
    const cacheKey = `${meta.baseUrl}::${meta.model}::${keyHash}`
    const cached = cache.get(cacheKey)
    if (cached) return cached

    const provider = createOpenAI({
      name: "reaslab",
      baseURL: meta.baseUrl,
      apiKey: meta.apiKey,
      fetch: async (input, init) => {
        // @ai-sdk/openai v2 classifies any non-GPT model as a "reasoning model" and
        // converts system messages to role:"developer". OpenAI-compatible endpoints
        // (e.g. DeepSeek) reject that role. Rewrite developer→system in the outgoing request body.
        if (init?.body && typeof init.body === "string") {
          try {
            const json = JSON.parse(init.body)
            if (Array.isArray(json?.messages) && json.messages.some((m: any) => m.role === "developer")) {
              json.messages = json.messages.map((m: any) =>
                m.role === "developer" ? { ...m, role: "system" } : m,
              )
              init = { ...init, body: JSON.stringify(json) }
            }
          } catch {
            // non-JSON body — leave unchanged
          }
        }
        const res = await fetch(input, init)
        return wrapSSE(res)
      },
    })

    const model = provider.chat(meta.model)
    cache.set(cacheKey, model)
    return model
  }

  /** Construct a MinimalModel from _meta for system.ts compatibility */
  export function modelFromMeta(meta: ProviderMeta): MinimalModel {
    return {
      id: meta.model,
      providerID: "reaslab",
      api: { id: meta.model },
      capabilities: {},
    }
  }

  export function clearCache() {
    cache.clear()
  }

  // --- Compatibility shims for code ported from opencode ---
  // These are used by session/prompt.ts and other modules that reference the old Provider API.

  /** Error thrown when a model is not found */
  export const ModelNotFoundError = NamedError.create(
    "ModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestions: z.array(z.string()).optional(),
    }),
  )

  /**
   * Compatibility shim: resolves a model by providerID + modelID.
   * In reaslab-agent, models are resolved at runtime via meta, so this
   * returns a MinimalModel stub. It never throws ModelNotFoundError.
   */
  export async function getModel(providerID: string, modelID: string): Promise<MinimalModel> {
    return {
      id: ModelID.make(modelID) as any as string,
      providerID: ProviderID.make(providerID) as any as string,
      api: { id: modelID },
      capabilities: {},
    }
  }

  /**
   * Compatibility shim: returns a LanguageModel for a MinimalModel.
   * Falls back to a dummy provider if no meta is available.
   */
  export async function getLanguage(model: MinimalModel): Promise<LanguageModel> {
    return fromMeta({
      model: model.id,
      baseUrl: "http://localhost:8080",
      apiKey: "dummy",
    })
  }

  /**
   * Compatibility shim: returns a default model reference.
   */
  export async function defaultModel(): Promise<{ providerID: ProviderID; modelID: ModelID }> {
    return { providerID: ProviderID.make("reaslab"), modelID: ModelID.make("default") }
  }

  /**
   * Compatibility shim: returns a small/fast model for a given provider.
   */
  export async function getSmallModel(_providerID: string): Promise<MinimalModel | undefined> {
    return undefined
  }

  /**
   * Compatibility shim: returns a provider info object.
   */
  export async function getProvider(providerID: string): Promise<{ id: string; options?: Record<string, any> }> {
    return { id: providerID }
  }

  /**
   * Compatibility shim: parse a "providerID/modelID" string.
   */
  export function parseModel(input: string): { providerID: ProviderID; modelID: ModelID } {
    const idx = input.indexOf("/")
    if (idx === -1) return { providerID: ProviderID.make("reaslab"), modelID: ModelID.make(input) }
    return { providerID: ProviderID.make(input.slice(0, idx)), modelID: ModelID.make(input.slice(idx + 1)) }
  }
}
