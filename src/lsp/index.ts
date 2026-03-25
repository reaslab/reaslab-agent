// Shim: LSP not used in reaslab-agent container
import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export namespace LSP {
  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
  }

  export const Range = z.object({
    start: z.object({ line: z.number(), character: z.number() }),
    end: z.object({ line: z.number(), character: z.number() }),
  }).meta({ ref: "Range" })
  export type Range = z.infer<typeof Range>

  export const Symbol = z.object({
    name: z.string(),
    kind: z.number(),
    location: z.object({ uri: z.string(), range: Range }),
  }).meta({ ref: "Symbol" })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z.object({
    name: z.string(),
    detail: z.string().optional(),
    kind: z.number(),
    range: Range,
    selectionRange: Range,
  }).meta({ ref: "DocumentSymbol" })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  export const Diagnostic = z.object({
    range: Range,
    message: z.string(),
    severity: z.number().optional(),
    source: z.string().optional(),
    file: z.string().optional(),
  }).meta({ ref: "Diagnostic" })
  export type Diagnostic = z.infer<typeof Diagnostic>

  export function prettyDiagnostic(d: Diagnostic): string {
    return `${d.file ?? ""}:${d.range.start.line}: ${d.message}`
  }

  export const Status = z.object({
    id: z.string(),
    name: z.string(),
    root: z.string(),
    status: z.union([z.literal("connected"), z.literal("error")]),
  }).meta({ ref: "LSPStatus" })
  export type Status = z.infer<typeof Status>

  export async function init(): Promise<void> {}
  export async function status(): Promise<Status[]> { return [] }
  export async function hasClients(_file: string): Promise<boolean> { return false }
  export async function touchFile(_file: string, _wait?: boolean): Promise<void> {}
  export async function diagnostics(): Promise<Record<string, Diagnostic[]>> { return {} }
  export async function hover(_input: { file: string; line: number; character: number }): Promise<null> { return null }
  export async function workspaceSymbol(_query: string): Promise<Symbol[]> { return [] }
  export async function documentSymbol(_uri: string): Promise<DocumentSymbol[]> { return [] }
  export async function definition(_input: { file: string; line: number; character: number }): Promise<null> { return null }
  export async function references(_input: { file: string; line: number; character: number }): Promise<null> { return null }
  export async function implementation(_input: { file: string; line: number; character: number }): Promise<null> { return null }
  export async function prepareCallHierarchy(_input: { file: string; line: number; character: number }): Promise<null> { return null }
  export async function incomingCalls(_input: { file: string; line: number; character: number }): Promise<null> { return null }
  export async function outgoingCalls(_input: { file: string; line: number; character: number }): Promise<null> { return null }
}
