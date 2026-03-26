// Adapter: converts opencode Tool.Info to Vercel AI SDK ToolSet
// Used to inject built-in tools (bash, read, write, etc.) into the agent loop

import { tool, type ToolSet } from "ai"
import fs from "fs/promises"
import path from "path"
import { BashTool } from "../tool/bash"
import { ReadTool } from "../tool/read"
import { WriteTool } from "../tool/write"
import { EditTool } from "../tool/edit"
import { GlobTool } from "../tool/glob"
import { GrepTool } from "../tool/grep"
import { WebFetchTool } from "../tool/webfetch"
import { ApplyPatchTool } from "../tool/apply_patch"
import { TodoWriteTool } from "../tool/todo"
import { TaskTool } from "../tool/task"
import { WebSearchTool } from "../tool/websearch"
import { CodeSearchTool } from "../tool/codesearch"
import { SkillTool } from "../tool/skill"
import { BatchTool } from "../tool/batch"
import type { Tool } from "../tool/tool"

/** Tools that modify files — need diff content in tool_call_update */
const FILE_WRITE_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch"])

/** Sentinel prefix for encoded diff appended to tool output string */
const DIFF_SENTINEL = "\x00DIFF\x00"

/** Structured diff info carrying optional reaslab collaborative editor sync payload */
export interface ToolResult {
  diff?: { type: "diff"; path: string; oldText?: string; newText: string }
}

/** Decode a tool output string that may carry an embedded diff */
export function decodeToolOutput(raw: unknown): { output: string; diff?: ToolResult["diff"] } {
  if (typeof raw !== "string") return { output: String(raw) }
  const idx = raw.indexOf(DIFF_SENTINEL)
  if (idx === -1) return { output: raw }
  const output = raw.slice(0, idx)
  try {
    const diff = JSON.parse(raw.slice(idx + DIFF_SENTINEL.length))
    return { output, diff }
  } catch {
    return { output }
  }
}

/** Shared side-channel: toolCallId → diff, populated during tool execution */
export const pendingDiffs = new Map<string, ToolResult["diff"]>()
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

/** Resolve the primary file path from tool args */
function resolveFilePath(toolId: string, args: Record<string, unknown>, workspace: string): string | undefined {
  const p = (args.filePath ?? args.path ?? args.file ?? "") as string
  if (!p) return undefined
  return path.isAbsolute(p) ? p : path.join(workspace, p)
}

/** Convert a single Tool.Info to an AI SDK tool */
async function adaptTool(
  info: Tool.Info,
  signal: AbortSignal,
  workspace: string,
): Promise<{ name: string; tool: any }> {
  const initialized = await info.init()
  const isFileWriter = FILE_WRITE_TOOLS.has(info.id)
  const createTool = tool as any

  return {
    name: info.id,
    tool: createTool({
      description: initialized.description,
      parameters: initialized.parameters as any,
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const absPath = isFileWriter ? resolveFilePath(info.id, args as any, workspace) : undefined

        // Read old content before modification
        let oldText: string | undefined
        if (absPath) {
          try { oldText = await fs.readFile(absPath, "utf-8") } catch {}
        }

        try {
          const result = await initialized.execute(args as any, makeCtx(signal))
          const output = result.output.replaceAll(workspace + "/", "").replaceAll(workspace, ".")

          // For file-modifying tools, embed diff as sentinel suffix for reaslab sync
          if (absPath) {
            let newText: string | undefined
            try { newText = await fs.readFile(absPath, "utf-8") } catch {}
            if (newText !== undefined) {
               const diff: ToolResult["diff"] = { type: "diff", path: absPath, oldText, newText }
               return output + DIFF_SENTINEL + JSON.stringify(diff)
            }
          }

          return output
        } catch (err: any) {
          return `Error: ${err.message}`
        }
      },
    }),
  }
}

/** Build the full built-in ToolSet to pass to streamText */
export async function buildBuiltinTools(signal: AbortSignal, workspace: string): Promise<ToolSet> {
  const infos: Tool.Info[] = [
    BashTool,
    ReadTool,
    WriteTool,
    EditTool,
    GlobTool,
    GrepTool,
    WebFetchTool,
    ApplyPatchTool,
    TodoWriteTool,
    TaskTool,
    WebSearchTool,
    CodeSearchTool,
    SkillTool,
    BatchTool,
  ]

  const entries = await Promise.allSettled(infos.map((info) => adaptTool(info, signal, workspace)))

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
