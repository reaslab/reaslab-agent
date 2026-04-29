// src/acp/agent-config.ts
import { Instance } from "@/project/instance"

/**
 * Session-scoped agent config store.
 * Populated by ACP server from _meta.agent_config on each session/prompt.
 * Read by tools (e.g. bash) to apply runtime configuration.
 */
export interface AgentConfig {
  bashTimeoutMs?: number
  /** When false, rawOutput is sent for ALL tools in tool_call_update notifications.
   *  Default (undefined/true) suppresses rawOutput for read, glob, grep, ls, codesearch,
   *  write, edit, multiedit, apply_patch, task, and skill tools. */
  suppressRawOutput?: boolean
}

export const ACPAgentConfig = Instance.state<Record<string, AgentConfig>>(() => ({}))
