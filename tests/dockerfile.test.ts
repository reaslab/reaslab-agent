import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8")
const server = readFileSync(join(repoRoot, "src/acp/server.ts"), "utf8")

describe("Docker runtime packaging", () => {
  test("places agent-schema.json where ACP server imports it", () => {
    expect(server).toContain('import agentSchema from "../../agent-schema.json"')
    expect(dockerfile).toContain("COPY agent-schema.json /app/agent-schema.json")
  })
})
