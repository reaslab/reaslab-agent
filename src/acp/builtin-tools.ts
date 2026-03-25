// Adapter: converts opencode Tool.Info to Vercel AI SDK ToolSet
// Used to inject built-in tools (bash, read, write, etc.) into the agent loop

import { tool, type ToolSet } from "ai"
import { BashTool } from "../tool/bash"
import { ReadTool } from "../tool/read"
import { WriteTool } from "../tool/write"
import { EditTool } from "../tool/edit"
import { GlobTool } from "../tool/glob"
import { GrepTool } from "../tool/grep"
import { WebFetchTool } from "../tool/webfetch"
import type { Tool } from "../tool/tool"

/** Fake Tool.Context — enough to satisfy built-in tool requirements */
function makeCtx(signal: AbortSignal): Tool.Context {
  return {
    sessionID: "acp-session" as any,
    messageID: "acp-msg" as any,
    agent: "default",
    abort: signal,
    callID: undefined,
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

/** Convert a single Tool.Info to an AI SDK tool */
async function adaptTool(info: Tool.Info, signal: AbortSignal): Promise<{ name: string; tool: ReturnType<typeof tool> }> {
  const initialized = await info.init()
  return {
    name: info.id,
    tool: tool({
      description: initialized.description,
      parameters: initialized.parameters as any,
      execute: async (args) => {
        try {
          const result = await initialized.execute(args as any, makeCtx(signal))
          return result.output
        } catch (err: any) {
          return `Error: ${err.message}`
        }
      },
    }),
  }
}

/** Build the full built-in ToolSet to pass to streamText */
export async function buildBuiltinTools(signal: AbortSignal): Promise<ToolSet> {
  const infos: Tool.Info[] = [
    BashTool,
    ReadTool,
    WriteTool,
    EditTool,
    GlobTool,
    GrepTool,
    WebFetchTool,
  ]

  const entries = await Promise.allSettled(infos.map((info) => adaptTool(info, signal)))

  const toolset: ToolSet = {}
  for (const result of entries) {
    if (result.status === "fulfilled") {
      toolset[result.value.name] = result.value.tool
    } else {
      console.error("[builtin-tools] failed to init tool:", result.reason)
    }
  }
  return toolset
}
