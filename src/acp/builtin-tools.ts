// Adapter: converts agent Tool.Info to Vercel AI SDK ToolSet
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
  structured?: unknown
}

function metadataRecord(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  return metadata as Record<string, unknown>
}

export function projectStructuredToolPayload(toolId: string, metadata: unknown): unknown {
  const record = metadataRecord(metadata)
  if (!record) return undefined

  switch (toolId) {
    case "todowrite":
    case "todoread": {
      const structured: Record<string, unknown> = {}
      if (Array.isArray(record.todos)) structured.todos = record.todos
      if (record.summary && typeof record.summary === "object") structured.summary = record.summary
      return Object.keys(structured).length > 0 ? structured : undefined
    }
    case "task": {
      const structured: Record<string, unknown> = {}
      if (typeof record.sessionId === "string") structured.sessionId = record.sessionId
      if (record.model && typeof record.model === "object") structured.model = record.model
      if (typeof record.resultText === "string") structured.resultText = record.resultText
      if (typeof record.resultEmpty === "boolean") structured.resultEmpty = record.resultEmpty
      if (typeof record.taskID === "string") structured.taskID = record.taskID
      if (record.resumable && typeof record.resumable === "object") structured.resumable = record.resumable
      return Object.keys(structured).length > 0 ? structured : undefined
    }
    case "skill": {
      const structured: Record<string, unknown> = {}
      if (typeof record.name === "string") structured.name = record.name
      if (typeof record.dir === "string") structured.dir = record.dir
      return Object.keys(structured).length > 0 ? structured : undefined
    }
    default:
      return undefined
  }
}

function encodeToolOutput(output: string, result: ToolResult): string {
  if (result.diff === undefined && result.structured === undefined) return output
  return output + DIFF_SENTINEL + JSON.stringify(result)
}

/** Decode a tool output string that may carry an embedded diff */
export function decodeToolOutput(raw: unknown): { output: string; diff?: ToolResult["diff"]; structured?: unknown } {
  if (typeof raw !== "string") return { output: String(raw) }
  const idx = raw.indexOf(DIFF_SENTINEL)
  if (idx === -1) return { output: raw }
  const output = raw.slice(0, idx)
  try {
    const decoded = JSON.parse(raw.slice(idx + DIFF_SENTINEL.length)) as ToolResult["diff"] | ToolResult
    if (decoded && typeof decoded === "object" && "type" in decoded && decoded.type === "diff") {
      return { output, diff: decoded }
    }
    if (decoded && typeof decoded === "object") {
      return {
        output,
        diff: (decoded as ToolResult).diff,
        structured: (decoded as ToolResult).structured,
      }
    }
    return { output }
  } catch {
    return { output }
  }
}

/** Shared side-channel: toolCallId → diff, populated during tool execution */
export const pendingDiffs = new Map<string, ToolResult["diff"]>()

function makeCtx(base: Tool.Context, signal: AbortSignal): Tool.Context {
  return {
    ...base,
    abort: signal,
    extra: {
      ...base.extra,
      collaborativeMode: true,
    },
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
  toolContext?: Tool.Context,
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
        if (!toolContext) {
          throw new Error(`Built-in ACP tool '${info.id}' requires a real ACP tool context`)
        }

        const absPath = isFileWriter ? resolveFilePath(info.id, args as any, workspace) : undefined

        // Read old content before modification
        let oldText: string | undefined
        if (absPath) {
          try { oldText = await fs.readFile(absPath, "utf-8") } catch {}
        }

        try {
          const result = await initialized.execute(args as any, makeCtx(toolContext, signal))
          const output = result.output
          const structured = projectStructuredToolPayload(info.id, result.metadata)

          // For file-modifying tools, embed diff as sentinel suffix for reaslab sync
          if (absPath) {
            let newText: string | undefined
            try { newText = await fs.readFile(absPath, "utf-8") } catch {}
            if (newText !== undefined) {
               const diff: ToolResult["diff"] = { type: "diff", path: absPath, oldText, newText }
               return encodeToolOutput(output, { diff, structured })
             }
          }

          return encodeToolOutput(output, { structured })
        } catch (err: any) {
          throw new Error(err?.message || String(err))
        }
      },
    }),
  }
}

/** Build the full built-in ToolSet to pass to streamText */
export async function buildBuiltinTools(signal: AbortSignal, workspace: string, toolContext?: Tool.Context): Promise<ToolSet> {
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

  const entries = await Promise.allSettled(infos.map((info) => adaptTool(info, signal, workspace, toolContext)))

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
