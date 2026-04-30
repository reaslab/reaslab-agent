import path from "path"

export namespace Config {
  export interface AgentDef {
    id: string
    name: string
    systemPrompt?: string
    tools?: string[]
    maxSteps?: number
  }

  export interface SkillsConfig {
    paths?: string[]
    urls?: string[]
    /** Maximum file size in bytes for a single SKILL.md (default: 256_000) */
    maxSkillFileBytes?: number
    /** Maximum number of skills included in the system prompt (default: 150) */
    maxSkillsInPrompt?: number
    /** Maximum total characters for the skills section in the system prompt (default: 30_000) */
    maxSkillsPromptChars?: number
    /** Enable file watching for SKILL.md hot-reload (default: true) */
    watch?: boolean
    /** Debounce interval in ms for file watch events (default: 250) */
    watchDebounceMs?: number
    /** Poll interval in ms to check for SKILL.md changes as fallback when watcher misses events (default: 10000, 0 to disable) */
    stalePollIntervalMs?: number
  }

  export interface AppConfig {
    workspace: string
    userId: string
    dataDir: string
    agents: AgentDef[]
    dockerHost?: string
    skills?: SkillsConfig
  }

  let _config: AppConfig | undefined

  /** Built-in agent definitions (default agent types) */
  const BUILTIN_AGENTS: AgentDef[] = [
    {
      id: "build",
      name: "Build",
      maxSteps: 200,
    },
    {
      id: "plan",
      name: "Plan",
      maxSteps: 50,
    },
    {
      id: "general",
      name: "General",
      maxSteps: 200,
    },
    {
      id: "explore",
      name: "Explore",
      maxSteps: 50,
    },
    {
      id: "compaction",
      name: "Compaction",
      maxSteps: 1,
    },
    {
      id: "title",
      name: "Title",
      maxSteps: 1,
    },
    {
      id: "summary",
      name: "Summary",
      maxSteps: 1,
    },
  ]

  export function get(): AppConfig {
    if (_config) return _config

    _config = {
      workspace: process.env.PROJECT_WORKSPACE || "/workspace",
      userId: process.env.REASLAB_USER_ID || "anonymous",
      dataDir: process.env.DATA_DIR || "/app/data",
      agents: BUILTIN_AGENTS,
      dockerHost: process.env.DOCKER_HOST,
      skills: {
        paths: ["skills"],
      },
    }

    return _config
  }

  /** Reset config (for testing) */
  export function reset() {
    _config = undefined
  }

  /** Get the database path */
  export function dbPath(): string {
    const cfg = get()
    return path.join(cfg.dataDir, "reaslab-agent.db")
  }
}
