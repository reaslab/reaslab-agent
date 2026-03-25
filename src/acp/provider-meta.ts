// src/acp/provider-meta.ts
import { Instance } from "@/project/instance"
import type { ProviderMeta } from "@/provider/provider"

/**
 * Session-scoped ProviderMeta store.
 * Populated by ACP server before calling SessionPrompt.prompt().
 * Read by LLM.stream() to resolve the runtime model.
 */
export const ACPProviderMeta = Instance.state<Record<string, ProviderMeta>>(() => ({}))
