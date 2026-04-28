// src/acp/agent-config.ts
import { Instance } from "@/project/instance"

/**
 * Session-scoped agent config store.
 * Populated by ACP server from _meta.agent_config on each session/prompt.
 * Read by tools (e.g. bash) to apply runtime configuration.
 */
export interface AgentConfig {
  bashTimeoutMs?: number
}

export const ACPAgentConfig = Instance.state<Record<string, AgentConfig>>(() => ({}))
