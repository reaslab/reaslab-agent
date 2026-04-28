import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8")
const server = readFileSync(join(repoRoot, "src/acp/server.ts"), "utf8")
const agentSchema = JSON.parse(readFileSync(join(repoRoot, "agent-schema.json"), "utf8"))

describe("Docker runtime packaging", () => {
  test("places agent-schema.json where ACP server imports it", () => {
    expect(server).toContain('import agentSchema from "../../agent-schema.json"')
    expect(dockerfile).toContain("COPY agent-schema.json /app/agent-schema.json")
  })
})

describe("agent-schema.json", () => {
  test("is a valid JSON Schema object with properties key", () => {
    expect(agentSchema.type).toBe("object")
    expect(agentSchema.properties).toBeDefined()
    expect(typeof agentSchema.properties).toBe("object")
  })
})
