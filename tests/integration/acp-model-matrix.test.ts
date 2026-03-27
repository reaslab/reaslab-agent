import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadModelMatrixConfig } from "../helpers/acp-model-config"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "acp-model-config-"))
  tempDirs.push(dir)
  return dir
}

describe("ACP model matrix config loader", () => {
  test("missing config is skipped in optional mode", async () => {
    const dir = await createTempDir()
    const filePath = join(dir, "acp-model-test.config.json")

    const result = await loadModelMatrixConfig({
      mode: "optional",
      filePath,
    })

    expect(result).toBeNull()
  })

  test("malformed config throws a clear validation error in required mode", async () => {
    const dir = await createTempDir()
    const filePath = join(dir, "acp-model-test.config.json")

    await writeFile(filePath, JSON.stringify({
      baseUrl: "",
      apiKey: "",
      models: [],
      timeoutMs: 1000,
    }))

    await expect(loadModelMatrixConfig({
      mode: "required",
      filePath,
    })).rejects.toThrow(/ACP model matrix config.*baseUrl.*apiKey.*models/i)
  })

  test("valid config yields baseUrl apiKey models and timeoutMs", async () => {
    const dir = await createTempDir()
    const filePath = join(dir, "acp-model-test.config.json")

    await writeFile(filePath, JSON.stringify({
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-api-key",
      models: ["model-a", "model-b"],
      timeoutMs: 25000,
    }))

    const result = await loadModelMatrixConfig({
      mode: "required",
      filePath,
    })

    expect(result).toEqual({
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-api-key",
      models: ["model-a", "model-b"],
      timeoutMs: 25000,
    })
  })

  test("default config path is resolved independently of process cwd", async () => {
    const originalCwd = process.cwd()
    const dir = await createTempDir()
    const filePath = join(originalCwd, "tests", "local", "acp-model-test.config.json")

    await mkdir(join(originalCwd, "tests", "local"), { recursive: true })
    await writeFile(filePath, JSON.stringify({
      baseUrl: "https://api.example.test/from-stable-default",
      apiKey: "stable-default-key",
      models: ["stable-default-model"],
      timeoutMs: 6789,
    }))

    process.chdir(dir)

    try {
      const result = await loadModelMatrixConfig({
        mode: "required",
      })

      expect(result).toEqual({
        baseUrl: "https://api.example.test/from-stable-default",
        apiKey: "stable-default-key",
        models: ["stable-default-model"],
        timeoutMs: 6789,
      })
    } finally {
      process.chdir(originalCwd)
      await rm(filePath, { force: true })
    }
  })
})
