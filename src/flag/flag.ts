import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const REASLAB_AUTO_SHARE = truthy("REASLAB_AUTO_SHARE")
  export const REASLAB_GIT_BASH_PATH = process.env["REASLAB_GIT_BASH_PATH"]
  export const REASLAB_CONFIG = process.env["REASLAB_CONFIG"]
  export declare const REASLAB_TUI_CONFIG: string | undefined
  export declare const REASLAB_CONFIG_DIR: string | undefined
  export const REASLAB_CONFIG_CONTENT = process.env["REASLAB_CONFIG_CONTENT"]
  export const REASLAB_DISABLE_AUTOUPDATE = truthy("REASLAB_DISABLE_AUTOUPDATE")
  export const REASLAB_ALWAYS_NOTIFY_UPDATE = truthy("REASLAB_ALWAYS_NOTIFY_UPDATE")
  export const REASLAB_DISABLE_PRUNE = truthy("REASLAB_DISABLE_PRUNE")
  export const REASLAB_DISABLE_TERMINAL_TITLE = truthy("REASLAB_DISABLE_TERMINAL_TITLE")
  export const REASLAB_PERMISSION = process.env["REASLAB_PERMISSION"]
  export const REASLAB_DISABLE_DEFAULT_PLUGINS = truthy("REASLAB_DISABLE_DEFAULT_PLUGINS")
  export const REASLAB_DISABLE_LSP_DOWNLOAD = truthy("REASLAB_DISABLE_LSP_DOWNLOAD")
  export const REASLAB_ENABLE_EXPERIMENTAL_MODELS = truthy("REASLAB_ENABLE_EXPERIMENTAL_MODELS")
  export const REASLAB_DISABLE_AUTOCOMPACT = truthy("REASLAB_DISABLE_AUTOCOMPACT")
  export const REASLAB_DISABLE_MODELS_FETCH = truthy("REASLAB_DISABLE_MODELS_FETCH")
  export const REASLAB_DISABLE_CLAUDE_CODE = truthy("REASLAB_DISABLE_CLAUDE_CODE")
  export const REASLAB_DISABLE_CLAUDE_CODE_PROMPT =
    REASLAB_DISABLE_CLAUDE_CODE || truthy("REASLAB_DISABLE_CLAUDE_CODE_PROMPT")
  export const REASLAB_DISABLE_CLAUDE_CODE_SKILLS =
    REASLAB_DISABLE_CLAUDE_CODE || truthy("REASLAB_DISABLE_CLAUDE_CODE_SKILLS")
  export const REASLAB_DISABLE_EXTERNAL_SKILLS =
    REASLAB_DISABLE_CLAUDE_CODE_SKILLS || truthy("REASLAB_DISABLE_EXTERNAL_SKILLS")
  export declare const REASLAB_DISABLE_PROJECT_CONFIG: boolean
  export const REASLAB_FAKE_VCS = process.env["REASLAB_FAKE_VCS"]
  export declare const REASLAB_CLIENT: string
  export const REASLAB_SERVER_PASSWORD = process.env["REASLAB_SERVER_PASSWORD"]
  export const REASLAB_SERVER_USERNAME = process.env["REASLAB_SERVER_USERNAME"]
  export const REASLAB_ENABLE_QUESTION_TOOL = truthy("REASLAB_ENABLE_QUESTION_TOOL")

  // Experimental
  export const REASLAB_EXPERIMENTAL = truthy("REASLAB_EXPERIMENTAL")
  export const REASLAB_EXPERIMENTAL_FILEWATCHER = Config.boolean("REASLAB_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const REASLAB_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "REASLAB_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const REASLAB_EXPERIMENTAL_ICON_DISCOVERY =
    REASLAB_EXPERIMENTAL || truthy("REASLAB_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["REASLAB_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const REASLAB_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("REASLAB_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const REASLAB_ENABLE_EXA =
    truthy("REASLAB_ENABLE_EXA") || REASLAB_EXPERIMENTAL || truthy("REASLAB_EXPERIMENTAL_EXA")
  export const REASLAB_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("REASLAB_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const REASLAB_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("REASLAB_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const REASLAB_EXPERIMENTAL_OXFMT = REASLAB_EXPERIMENTAL || truthy("REASLAB_EXPERIMENTAL_OXFMT")
  export const REASLAB_EXPERIMENTAL_LSP_TY = truthy("REASLAB_EXPERIMENTAL_LSP_TY")
  export const REASLAB_EXPERIMENTAL_LSP_TOOL = REASLAB_EXPERIMENTAL || truthy("REASLAB_EXPERIMENTAL_LSP_TOOL")
  export const REASLAB_DISABLE_FILETIME_CHECK = Config.boolean("REASLAB_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const REASLAB_EXPERIMENTAL_PLAN_MODE = REASLAB_EXPERIMENTAL || truthy("REASLAB_EXPERIMENTAL_PLAN_MODE")
  export const REASLAB_EXPERIMENTAL_WORKSPACES = REASLAB_EXPERIMENTAL || truthy("REASLAB_EXPERIMENTAL_WORKSPACES")
  export const REASLAB_EXPERIMENTAL_MARKDOWN = !falsy("REASLAB_EXPERIMENTAL_MARKDOWN")
  export const REASLAB_MODELS_URL = process.env["REASLAB_MODELS_URL"]
  export const REASLAB_MODELS_PATH = process.env["REASLAB_MODELS_PATH"]
  export const REASLAB_DB = process.env["REASLAB_DB"]
  export const REASLAB_DISABLE_CHANNEL_DB = truthy("REASLAB_DISABLE_CHANNEL_DB")
  export const REASLAB_SKIP_MIGRATIONS = truthy("REASLAB_SKIP_MIGRATIONS")
  export const REASLAB_STRICT_CONFIG_DEPS = truthy("REASLAB_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for REASLAB_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "REASLAB_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("REASLAB_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for REASLAB_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "REASLAB_TUI_CONFIG", {
  get() {
    return process.env["REASLAB_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for REASLAB_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "REASLAB_CONFIG_DIR", {
  get() {
    return process.env["REASLAB_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for REASLAB_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "REASLAB_CLIENT", {
  get() {
    return process.env["REASLAB_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
