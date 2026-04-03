import { Config } from "@/config/config"
import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import type { WorkspaceID } from "@/control-plane/schema"
import { SessionID } from "@/session/schema"

export namespace SystemPrompt {
  export type Scope = {
    workspaceID?: WorkspaceID
    sessionID?: SessionID
  }

  // --- Snapshot cache: keyed by "workspaceID:sessionID" ---
  type CachedSnapshot = { prompt: string; version: number }
  const snapshotCache = Instance.state(() => new Map<string, CachedSnapshot>())

  function snapshotCacheKey(scope?: Scope): string {
    return `${scope?.workspaceID ?? ""}:${scope?.sessionID ?? ""}`
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gpt")) return [PROMPT_CODEX]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_DEFAULT]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
      ].join("\n"),
    ]
  }

  export async function skills(agent: Agent.Info, scope?: Scope) {
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return

    // Check snapshot cache
    const cacheKey = snapshotCacheKey(scope)
    const currentVersion = Skill.getVersion()
    const cache = snapshotCache()
    const cached = cache.get(cacheKey)

    // Skip cache if skill files changed on disk (needsReload flag set by watcher)
    const needsReload = Skill.hasNeedsReload(Instance.directory)

    if (!needsReload && cached && cached.version >= currentVersion && currentVersion > 0) {
      return cached.prompt
    }

    // Rebuild
    const base = await Skill.available(agent)
    const runtime = await Skill.runtimeAll(scope)
    const merged = new Map(base.map((skill) => [skill.name, skill] as const))
    for (const skill of runtime) {
      if (Permission.evaluate("skill", skill.name, agent.permission).action === "deny") continue
      merged.set(skill.name, skill)
    }
    const list = Array.from(merged.values()).toSorted((a, b) => a.name.localeCompare(b.name))

    const cfg = Config.get().skills
    const limits = {
      maxSkillsInPrompt: cfg?.maxSkillsInPrompt ?? Skill.DEFAULT_MAX_SKILLS_IN_PROMPT,
      maxSkillsPromptChars: cfg?.maxSkillsPromptChars ?? Skill.DEFAULT_MAX_SKILLS_PROMPT_CHARS,
    }
    const result = Skill.fmtWithBudget(list, limits)

    const prompt = [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      result.text,
    ].join("\n")

    // Cache the result
    cache.set(cacheKey, { prompt, version: Skill.getVersion() })

    return prompt
  }
}
