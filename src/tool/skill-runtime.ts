import * as fs from "fs/promises"
import path from "path"
import z from "zod"
import { Command } from "@/command"
import { WorkspaceID } from "@/control-plane/schema"
import { Instance } from "@/project/instance"
import { SessionID } from "@/session/schema"
import { Skill } from "@/skill"
import { Flag } from "@/flag/flag"
import { Glob } from "@/util/glob"
import { Tool } from "./tool"

const ScopeSchema = z.enum(["workspace", "session"])

const WorkspaceScopeParams = z.object({
  scope: z.literal("workspace"),
  workspaceID: WorkspaceID.zod,
})

const SessionScopeParams = z.object({
  scope: z.literal("session"),
  workspaceID: WorkspaceID.zod,
  sessionID: SessionID.zod,
})

const DefaultWorkspaceScopeParams = z.object({
  workspaceID: WorkspaceID.zod,
})

const FinderParams = z.union([
  WorkspaceScopeParams.extend({
    query: z.string().optional(),
    includeHidden: z.boolean().optional(),
  }),
  SessionScopeParams.extend({
    query: z.string().optional(),
    includeHidden: z.boolean().optional(),
  }),
  DefaultWorkspaceScopeParams.extend({
    query: z.string().optional(),
    includeHidden: z.boolean().optional(),
  }),
])

const DefaultSessionScopeParams = z.object({
  workspaceID: WorkspaceID.zod,
  sessionID: SessionID.zod,
})

const RuntimeScopeSchema = z.union([WorkspaceScopeParams, SessionScopeParams])

const LoadParams = z.union([
  SessionScopeParams.extend({
    localPath: z.string(),
  }),
  WorkspaceScopeParams.extend({
    localPath: z.string(),
  }),
  DefaultSessionScopeParams.extend({
    localPath: z.string(),
  }),
])

const UnloadParams = z.union([
  SessionScopeParams.extend({
    name: z.string(),
  }),
  WorkspaceScopeParams.extend({
    name: z.string(),
  }),
  DefaultSessionScopeParams.extend({
    name: z.string(),
  }),
])

type FinderParamsInput = z.infer<typeof FinderParams>
type LoadParamsInput = z.infer<typeof LoadParams>
type UnloadParamsInput = z.infer<typeof UnloadParams>

type RuntimeScopeName = z.infer<typeof ScopeSchema>
type RuntimeScopeArgs = z.infer<typeof RuntimeScopeSchema>
type WorkspaceScope = z.infer<typeof WorkspaceScopeParams>
type SessionScope = z.infer<typeof SessionScopeParams>
type ScopedParams = WorkspaceScope | SessionScope
type FinderExtras = {
  query?: string
  includeHidden?: boolean
}
type LoadExtras = {
  localPath: string
}
type UnloadExtras = {
  name: string
}
type NormalizedFinderParams = ScopedParams & FinderExtras
type NormalizedLoadParams = ScopedParams & LoadExtras
type NormalizedUnloadParams = ScopedParams & UnloadExtras

type RuntimeToolScope = {
  scope: RuntimeScopeName
  workspaceID: z.infer<typeof WorkspaceID.zod>
  sessionID?: z.infer<typeof SessionID.zod>
}

type DefaultSessionScopeInput = z.infer<typeof DefaultSessionScopeParams>

const deniedPathState = Instance.state(() => new Map<string, Set<string>>())

function requireScope(scope: RuntimeScopeName, args: RuntimeScopeArgs) {
  if (!args.workspaceID) {
    throw new Error(`${scope} scope requires workspaceID`)
  }
  if (scope === "session" && !("sessionID" in args && args.sessionID)) {
    throw new Error("session scope requires sessionID")
  }
}

function deniedPathKey(input: RuntimeToolScope) {
  return input.scope === "workspace"
    ? `workspace:${input.workspaceID}`
    : `session:${input.workspaceID}:${input.sessionID}`
}

function deniedPaths(input: RuntimeToolScope) {
  const state = deniedPathState()
  const key = deniedPathKey(input)
  let denied = state.get(key)
  if (!denied) {
    denied = new Set<string>()
    state.set(key, denied)
  }
  return denied
}

function rememberDeniedPath(input: RuntimeToolScope, localPath: string) {
  deniedPaths(input).add(localPath)
}

function clearDeniedPath(input: RuntimeToolScope, localPath: string) {
  deniedPaths(input).delete(localPath)
}

function hasScope(input: FinderParamsInput | LoadParamsInput | UnloadParamsInput): input is ScopedParams {
  return "scope" in input && (input.scope === "workspace" || input.scope === "session")
}

function asSessionScope<T extends DefaultSessionScopeInput | SessionScope>(input: T): T & { scope: "session" } {
  return {
    ...input,
    scope: "session",
  }
}

function normalizeFinderScope(input: FinderParamsInput): NormalizedFinderParams {
  if (hasScope(input)) return input
  return { ...input, scope: "workspace" }
}

function normalizeLoadScope(input: LoadParamsInput): NormalizedLoadParams {
  if (hasScope(input)) return input
  return asSessionScope(input)
}

function normalizeUnloadScope(input: UnloadParamsInput): NormalizedUnloadParams {
  if (hasScope(input)) return input
  return asSessionScope(input)
}

async function ensureRuntimeScope(input: FinderParamsInput | LoadParamsInput | UnloadParamsInput) {
  await ensureDiscovered()
}

async function detectSkillConflict(name: string, scope: ScopedParams, location?: string) {
  const discoveredMatches = await Glob.scan("**/SKILL.md", {
    cwd: Instance.directory,
    absolute: true,
    include: "file",
    symlink: true,
  })
  const discoveredSkills = await Promise.all(
    discoveredMatches.map((file) => Skill.parseRuntimeInfo(file, { invalid: "ignore", log: false })),
  )
  const conflictingDiscovered = discoveredSkills.find(
    (skill) => skill?.name === name && skill.location !== location,
  )
  if (conflictingDiscovered) return conflictingDiscovered

  const runtimeMatches = (await Skill.runtimeAll(scopeInput(scope), {
    includeHidden: true,
  })).filter((skill) => skill.name === name)

  const conflictingRuntime = runtimeMatches.find((skill) => skill.location !== location)
  if (conflictingRuntime) return conflictingRuntime

  const existingRuntime = runtimeMatches.find((skill) => skill.location === location)
  if (existingRuntime) return existingRuntime

  return Skill.get(name)
}

function scopeInput(args: RuntimeScopeArgs) {
  requireScope(args.scope, args)
  return {
    workspaceID: args.workspaceID,
    sessionID: args.scope === "session" ? args.sessionID : undefined,
  }
}

function hiddenRoot(args: RuntimeScopeArgs) {
  const workspaceKey = String(args.workspaceID)
  const sessionKey = args.scope === "session" ? String(args.sessionID) : "session"
  return path.join(
    Instance.directory,
    ".opencode",
    "runtime-skill-hidden",
    args.scope,
    args.scope === "session" ? `${workspaceKey}-${sessionKey}` : workspaceKey,
  )
}

async function hideSkill(name: string, args: RuntimeScopeArgs) {
  await ensureDiscovered()
  await Skill.runtimeLoad({
    scope: args.scope,
    root: hiddenRoot(args),
    hide: [name],
    ...scopeInput(args),
  })
}

async function ensureDiscovered() {
  await Skill.runtimeLoad({
    scope: "discovered",
    root: Instance.directory,
  })
}

async function parseLocalSkill(localPath: string) {
  await fs.access(localPath).catch(() => {
    throw new Error(`Local skill path is inaccessible or missing: ${localPath}`)
  })

  const skill = await Skill.parseRuntimeInfo(localPath, {
    invalid: "throw",
    log: false,
  }).catch((error) => {
    if (Skill.InvalidError.isInstance(error)) {
      throw new Error(error.data.message ?? `Invalid skill frontmatter in ${localPath}`)
    }
    throw error
  })

  if (!skill) {
    throw new Error(`Invalid skill frontmatter in ${localPath}`)
  }

  return skill
}

async function listVisibleSkills(args: NormalizedFinderParams) {
  const visible = await Skill.runtimeAll(scopeInput(args), {
    includeHidden: args.includeHidden === true,
  })
  const denied = deniedPaths(args)
  return visible.filter((skill) => !denied.has(skill.location))
}

function formatSkillList(skills: Skill.Info[]) {
  if (skills.length === 0) return "No skills found"
  return skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
}

export const SkillFinderTool = Tool.define("skill-finder", {
  description: "Find runtime skills available in this workspace or session",
  parameters: FinderParams,
  async execute(params) {
    await ensureRuntimeScope(params)
    const normalized = normalizeFinderScope(params)
    const scope = normalized.scope
    const visible = await listVisibleSkills(normalized)
    const denied = deniedPaths(normalized)
    const matches = params.query
      ? visible.filter((skill) => skill.name === params.query)
      : visible

    if (matches.length > 0) {
      return {
        title: params.query ?? "runtime skills",
        output: formatSkillList(matches),
        metadata: {
          status: "ok",
          scope,
          includeHidden: params.includeHidden === true,
        },
      }
    }

    if (params.query && params.includeHidden) {
      const hidden = await Skill.runtimeGet(params.query, scopeInput(normalized), {
        includeHidden: true,
      })
      if (hidden && !denied.has(hidden.location)) {
        return {
          title: hidden.name,
          output: formatSkillList([hidden]),
          metadata: {
            status: "ok",
            scope,
            includeHidden: true,
          },
        }
      }
    }

    return {
      title: params.query ?? "runtime skills",
      output: params.query ? `No runtime skill found for query: ${params.query}` : "No skills found",
      metadata: {
        status: "not_found",
        scope,
        includeHidden: params.includeHidden === true,
      },
    }
  },
})

export const LoadSkillTool = Tool.define("load-skill", {
  description: "Load a runtime skill into workspace or session scope",
  parameters: LoadParams,
  async execute(params, ctx) {
    await ensureRuntimeScope(params)
    const normalized = normalizeLoadScope(params)
    const scope = normalized.scope
    const localPath = path.isAbsolute(params.localPath) ? params.localPath : path.resolve(Instance.directory, params.localPath)

    await ctx
      .ask({
        permission: "read",
        patterns: [localPath],
        always: ["*"],
        metadata: {},
      })
      .catch((error) => {
        rememberDeniedPath(normalized, localPath)
        throw error
      })

    const skill = await parseLocalSkill(localPath)
    const command = await Command.get(skill.name)
    if (command) {
      return {
        title: skill.name,
        output: `Cannot load skill \"${skill.name}\" because it conflicts with existing command \"${command.name}\".`,
        metadata: {
          status: "command_conflict",
          scope,
          name: skill.name,
        },
      }
    }

    const skillConflict = await detectSkillConflict(skill.name, normalized, localPath)
    if (skillConflict && skillConflict.location !== localPath) {
      return {
        title: skill.name,
        output: `Cannot load skill "${skill.name}" because it conflicts with existing skill "${skillConflict.name}".`,
        metadata: {
          status: "skill_conflict",
          scope,
          name: skill.name,
        },
      }
    }

    await ctx
      .ask({
        permission: "skill",
        patterns: [skill.name],
        always: [skill.name],
        metadata: {
          action: "load",
          scope,
          localPath,
        },
      })
      .catch((error) => {
        rememberDeniedPath(normalized, localPath)
        throw error
      })

    await Skill.runtimeLoad({
      scope,
      root: path.dirname(localPath),
      file: localPath,
      ...scopeInput(normalized),
    })
    clearDeniedPath(normalized, localPath)

    return {
      title: skill.name,
      output: `Loaded runtime skill ${skill.name} in ${scope} scope.`,
      metadata: {
        status: "ok",
        scope,
        name: skill.name,
      },
    }
  },
})

export const UnloadSkillTool = Tool.define("unload-skill", {
  description: "Hide a runtime skill from workspace or session scope",
  parameters: UnloadParams,
  async execute(params, ctx) {
    await ensureRuntimeScope(params)
    const normalized = normalizeUnloadScope(params)

    await ctx.ask({
      permission: "skill",
      patterns: [normalized.name],
      always: [normalized.name],
      metadata: {
        action: "unload",
        scope: normalized.scope,
      },
    })

    await hideSkill(normalized.name, normalized)

    return {
      title: normalized.name,
      output: `Hidden runtime skill ${normalized.name} in ${normalized.scope} scope.`,
      metadata: {
        status: "ok",
        scope: normalized.scope,
        name: normalized.name,
      },
    }
  },
})

export const RuntimeSkillTools = [SkillFinderTool, LoadSkillTool, UnloadSkillTool] as const

export function runtimeSkillToolsEnabled() {
  return Flag.OPENCODE_ENABLE_QUESTION_TOOL || ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT)
}
