import { beforeEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { ApplyPatchTool } from "../../src/tool/apply_patch"

const worktree = path.resolve(import.meta.dir, "..", "..")
const fixturePath = path.join(worktree, "tests", "fixtures", "apply-patch-readme.txt")

describe("ApplyPatchTool", () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(worktree, "migration"), { recursive: true })
    const current = await fs.readFile(fixturePath, "utf-8").catch(() => "")
    if (current !== "before\n") {
      await fs.writeFile(fixturePath, "before\n", "utf-8")
    }
  })

  test("uses the update header path instead of the action keyword", async () => {
    expect(await fs.readFile(fixturePath, "utf-8")).toBe("before\n")

    const result = await Instance.provide({
      directory: worktree,
      fn: async () => {
        const tool = await ApplyPatchTool.init()
        return await tool.execute(
          {
            patchText: [
              "*** Begin Patch",
              "*** Update File: tests/fixtures/apply-patch-readme.txt",
              "-before",
              "+after",
              "*** End Patch",
            ].join("\n"),
          },
          {
            sessionID: SessionID.make("session_test"),
            messageID: MessageID.make("message_test"),
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
          },
        )
      },
    })

    expect(result.output).toContain("Success. Updated the following files:")
    expect(await fs.readFile(fixturePath, "utf-8")).toBe("after\n")
  })
})
