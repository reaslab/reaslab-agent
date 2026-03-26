import { describe, expect, test } from "bun:test"
import { Patch } from "../../src/patch/index"

describe("Patch.parsePatch", () => {
  test("parses update file headers into update hunks", () => {
    const result = Patch.parsePatch([
      "*** Begin Patch",
      "*** Update File: src/example.ts",
      "@@",
      "-oldValue",
      "+newValue",
      "*** End Patch",
    ].join("\n"))

    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0]?.type).toBe("update")
    expect(result.hunks[0]?.path).toBe("src/example.ts")
  })

  test("parses add and delete file headers with correct types and paths", () => {
    const result = Patch.parsePatch([
      "*** Begin Patch",
      "*** Add File: notes.txt",
      "+hello",
      "*** Delete File: old.txt",
      "*** End Patch",
    ].join("\n"))

    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[0]).toMatchObject({
      type: "add",
      path: "notes.txt",
    })
    expect(result.hunks[1]).toMatchObject({
      type: "delete",
      path: "old.txt",
    })
  })

  test("captures move to headers as move_path on update hunks", () => {
    const result = Patch.parsePatch([
      "*** Begin Patch",
      "*** Update File: src/example.ts",
      "*** Move to: src/new.ts",
      "@@",
      " sameLine",
      "*** End Patch",
    ].join("\n"))

    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0]?.type).toBe("update")
    expect(result.hunks[0]?.path).toBe("src/example.ts")
    expect(result.hunks[0]?.move_path).toBe("src/new.ts")
  })

  test("normalizes CRLF patch text before parsing headers and chunks", () => {
    const result = Patch.parsePatch([
      "*** Begin Patch",
      "*** Update File: src/example.ts",
      "@@",
      "-oldValue",
      "+newValue",
      "*** End Patch",
    ].join("\r\n"))

    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0]).toMatchObject({
      type: "update",
      path: "src/example.ts",
    })
    expect(result.hunks[0]?.chunks).toEqual([
      { type: "context", content: "@@" },
      { type: "remove", content: "oldValue" },
      { type: "add", content: "newValue" },
    ])
  })
})
