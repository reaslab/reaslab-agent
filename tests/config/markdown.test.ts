import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { ConfigMarkdown } from "../../src/config/markdown"

const tempDirs: string[] = []

describe("ConfigMarkdown.parse", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    )
  })

  test("parses CRLF frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "reaslab-config-markdown-"))
    tempDirs.push(dir)

    const file = path.join(dir, "skill.md")
    await writeFile(
      file,
      [
        "---",
        "name: test-skill",
        "description: Test skill description",
        "---",
        "# Skill body",
        "",
      ].join("\r\n"),
    )

    const result = await ConfigMarkdown.parse(file)

    expect(result.data).toEqual({
      name: "test-skill",
      description: "Test skill description",
    })
    expect(result.content).toBe("# Skill body\r\n")
  })
})
