import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const modelMatrixConfigSchema = z.object({
  baseUrl: z.string().trim().min(1, "baseUrl must be a non-empty string"),
  apiKey: z.string().trim().min(1, "apiKey must be a non-empty string"),
  models: z.array(z.string().trim().min(1, "models entries must be non-empty strings")).min(1, "models must contain at least one entry"),
  timeoutMs: z.number().int().positive().default(30000),
})

export type ModelMatrixConfig = z.infer<typeof modelMatrixConfigSchema>

type LoadModelMatrixConfigOptions = {
  mode: "optional" | "required"
  filePath?: string
}

const defaultConfigPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "local",
  "acp-model-test.config.json",
)

function createMissingConfigError(filePath: string) {
  return new Error(
    `ACP model matrix config is required but was not found at ${filePath}. Copy tests/local/acp-model-test.config.example.json to tests/local/acp-model-test.config.json and fill in local credentials.`,
  )
}

function createValidationError(filePath: string, error: z.ZodError) {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ")

  return new Error(`ACP model matrix config at ${filePath} is invalid: ${issues}`)
}

export async function loadModelMatrixConfig(options: LoadModelMatrixConfigOptions): Promise<ModelMatrixConfig | null> {
  const filePath = options.filePath ?? defaultConfigPath

  let parsed: unknown

  try {
    const content = await readFile(filePath, "utf8")
    parsed = JSON.parse(content)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      if (options.mode === "optional") {
        return null
      }

      throw createMissingConfigError(filePath)
    }

    throw new Error(`ACP model matrix config at ${filePath} could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }

  const result = modelMatrixConfigSchema.safeParse(parsed)

  if (!result.success) {
    throw createValidationError(filePath, result.error)
  }

  return result.data
}
