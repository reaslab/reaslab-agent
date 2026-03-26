import { readFileSync } from "fs"

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
          if (l.startsWith("@@")) {
            // Hunk separator: "@@ <context text>" — strip the @@ prefix and treat
            // the remainder as a context line used to locate the edit site.
            const contextStr = l.slice(2).trim()
            if (contextStr) {
              chunks.push({ type: "context", content: contextStr })
            }
          } else if (l.startsWith("+")) {
            chunks.push({ type: "add", content: l.slice(1) })
          } else if (l.startsWith("-")) {
            chunks.push({ type: "remove", content: l.slice(1) })
          } else if (l.startsWith(" ")) {
            chunks.push({ type: "context", content: l.slice(1) })
          }
          // Blank lines or unrecognised markers are skipped
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

  /**
   * Apply `chunks` (parsed from an Update hunk) to the file at `filePath` and
   * return the new file content.
   *
   * Algorithm:
   *  - Iterate through chunks in order.
   *  - "context" chunks locate the corresponding line in the original file;
   *    all intervening lines are preserved as-is.
   *  - "remove" chunks locate and discard the corresponding original line.
   *  - "add" chunks inject a new line at the current position.
   *  - Any remaining original lines after the last chunk are appended.
   */
  export function deriveNewContentsFromChunks(
    filePath: string,
    chunks: Chunk[],
  ): { content: string } {
    const originalContent = readFileSync(filePath, "utf-8")
    const origLines = originalContent.split("\n")

    // Strip the trailing empty element produced by a final newline so that
    // line counts stay consistent.
    if (origLines.length > 0 && origLines[origLines.length - 1] === "") {
      origLines.pop()
    }

    const result: string[] = []
    let origIdx = 0

    const findLine = (target: string, from: number): number => {
      // Exact match first
      for (let j = from; j < origLines.length; j++) {
        if (origLines[j] === target) return j
      }
      // Fallback: trimmed match
      const trimmed = target.trim()
      for (let j = from; j < origLines.length; j++) {
        if (origLines[j].trim() === trimmed) return j
      }
      return -1
    }

    for (const chunk of chunks) {
      if (chunk.type === "context") {
        const found = findLine(chunk.content, origIdx)
        if (found !== -1) {
          // Preserve every original line up to and including the context line.
          for (let j = origIdx; j <= found; j++) {
            result.push(origLines[j])
          }
          origIdx = found + 1
        }
        // If the context line isn't found, silently skip — the patch is malformed
        // but we still apply the remaining chunks rather than aborting.
      } else if (chunk.type === "remove") {
        const found = findLine(chunk.content, origIdx)
        if (found !== -1) {
          // Preserve lines before the removed line, then discard it.
          for (let j = origIdx; j < found; j++) {
            result.push(origLines[j])
          }
          origIdx = found + 1
        }
      } else if (chunk.type === "add") {
        result.push(chunk.content)
      }
    }

    // Append any remaining original lines after the last chunk.
    for (let j = origIdx; j < origLines.length; j++) {
      result.push(origLines[j])
    }

    return { content: result.join("\n") + "\n" }
  }
}
