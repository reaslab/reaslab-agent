// Stub: Patch module for apply_patch tool
// This is a placeholder — the actual implementation should be ported from opencode

export namespace Patch {
  export interface Chunk {
    type: "context" | "add" | "remove"
    content: string
    lineNumber?: number
  }

  export interface Hunk {
    path: string
    type: "add" | "update" | "delete"
    contents: string
    chunks: Chunk[]
    move_path?: string
  }

  export interface ParseResult {
    hunks: Hunk[]
  }

  export function parsePatch(patchText: string): ParseResult {
    // Minimal parser for apply_patch tool
    const hunks: Hunk[] = []
    const lines = patchText.replace(/\r\n/g, "\n").split("\n")
    let i = 0
    const matchFileHeader = (value: string) =>
      value.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/)
    const isFileHeader = (value: string) => Boolean(matchFileHeader(value))

    while (i < lines.length) {
      const line = lines[i]

      const fileHeader = matchFileHeader(line)

      if (fileHeader?.[1] === "Add") {
        const filePath = fileHeader[2]
        i++
        let contents = ""
        while (i < lines.length && lines[i] !== "*** End Patch" && !isFileHeader(lines[i])) {
          contents += (contents ? "\n" : "") + (lines[i].startsWith("+") ? lines[i].slice(1) : lines[i])
          i++
        }
        hunks.push({ path: filePath, type: "add", contents, chunks: [] })
        continue
      }

      if (fileHeader?.[1] === "Delete") {
        hunks.push({ path: fileHeader[2], type: "delete", contents: "", chunks: [] })
        i++
        continue
      }

      if (fileHeader?.[1] === "Update") {
        const filePath = fileHeader[2]
        i++

        let moveTarget: string | undefined
        const moveMatch = (lines[i] ?? "").match(/^\*\*\* Move to: (.+)$/)
        if (moveMatch) {
          moveTarget = moveMatch[1]
          i++
        }

        const chunks: Chunk[] = []
        while (i < lines.length && lines[i] !== "*** End Patch" && !isFileHeader(lines[i])) {
          const l = lines[i]
          if (l.startsWith("+")) {
            chunks.push({ type: "add", content: l.slice(1) })
          } else if (l.startsWith("-")) {
            chunks.push({ type: "remove", content: l.slice(1) })
          } else {
            chunks.push({ type: "context", content: l.startsWith(" ") ? l.slice(1) : l })
          }
          i++
        }

        hunks.push({
          path: filePath,
          type: "update",
          contents: "",
          chunks,
          move_path: moveTarget,
        })
        continue
      } else {
        i++
      }
    }

    return { hunks }
  }

  export function deriveNewContentsFromChunks(
    _filePath: string,
    chunks: Chunk[],
  ): { content: string } {
    // This is a simplified implementation
    const result: string[] = []
    for (const chunk of chunks) {
      if (chunk.type === "context" || chunk.type === "add") {
        result.push(chunk.content)
      }
      // "remove" chunks are skipped (they represent old content being removed)
    }
    return { content: result.join("\n") + "\n" }
  }
}
