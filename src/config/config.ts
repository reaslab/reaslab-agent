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

  /** Built-in agent definitions (matching opencode's defaults) */
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
