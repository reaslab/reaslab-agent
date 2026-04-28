// Side-channel registry: maps child sessionID → parent task context.
// Populated by task.ts when a sub-agent session is created, consumed by
// server.ts to forward child-session ACP events with sub-agent _meta.

export interface ChildSessionInfo {
  parentSessionID: string
  toolCallId: string
  agentName: string
}

/** childSessionID → info */
export const childSessionRegistry = new Map<string, ChildSessionInfo>()
