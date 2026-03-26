import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { NamedError } from "@opencode-ai/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import type { WorkspaceID } from "@/control-plane/schema"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import type { SessionID } from "@/session/schema"
import { Filesystem } from "@/util/filesystem"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { Discovery } from "./discovery"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
  const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
  const SKILL_PATTERN = "**/SKILL.md"

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  type State = {
    skills: Record<string, Info>
    dirs: Set<string>
    task?: Promise<void>
  }

  type Cache = State & {
    ensure: () => Promise<void>
  }

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly all: () => Effect.Effect<Info[]>
    readonly dirs: () => Effect.Effect<string[]>
    readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  }

  type RuntimeScopeName = "discovered" | "workspace" | "session"

  type RuntimeScope = {
    workspaceID?: WorkspaceID
    sessionID?: SessionID
  }

  type RuntimeLoadInput = RuntimeScope & {
    scope: RuntimeScopeName
    root: string
    file?: string
    hide?: string[]
  }

  type RuntimeUnloadInput = RuntimeScope & {
    scope: RuntimeScopeName
    names?: string[]
  }

  type RuntimeSourceState = {
    skills: Map<string, Info>
    hidden: Set<string>
  }

  type RuntimeOverlayState = {
    sources: Map<string, RuntimeSourceState>
  }

  export type RuntimeOverlay = {
    load(input: RuntimeLoadInput): Promise<void>
    unload(input: RuntimeUnloadInput): Promise<void>
    all(scope?: RuntimeScope, opts?: { includeHidden?: boolean }): Promise<Info[]>
    get(name: string, scope?: RuntimeScope, opts?: { includeHidden?: boolean }): Promise<Info | undefined>
  }

  type ParsedInfoOptions = {
    invalid?: "throw" | "ignore"
    log?: boolean
  }

  const runtimeState = Instance.state(() => runtimeOverlay())

  const parseInfo = (location: string, md: { data: unknown; content: string }) => {
    const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error,
      }
    }

    return {
      success: true as const,
      info: {
        name: parsed.data.name,
        description: parsed.data.description,
        location,
        content: md.content,
      } satisfies Info,
    }
  }

  const add = async (state: State, match: string) => {
    const md = await ConfigMarkdown.parse(match).catch(async (err: any) => {
      const message = (ConfigMarkdown as any).FrontmatterError?.isInstance?.(err)
        ? err.data.message
        : `Failed to parse skill ${match}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load skill", { skill: match, err })
      return undefined
    })

    if (!md) return

    const parsed = parseInfo(match, md)
    if (!parsed.success) return

    if (state.skills[parsed.info.name]) {
      log.warn("duplicate skill name", {
        name: parsed.info.name,
        existing: state.skills[parsed.info.name].location,
        duplicate: match,
      })
    }

    state.dirs.add(path.dirname(match))
    state.skills[parsed.info.name] = parsed.info
  }

  const scan = async (state: State, root: string, pattern: string, opts?: { dot?: boolean; scope?: string }) => {
    return Glob.scan(pattern, {
      cwd: root,
      absolute: true,
      include: "file",
      symlink: true,
      dot: opts?.dot,
    })
      .then((matches) => Promise.all(matches.map((match) => add(state, match))))
      .catch((error) => {
        if (!opts?.scope) throw error
        log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      })
  }

  export const parseRuntimeInfo = async (location: string, opts?: ParsedInfoOptions) => {
    const logErrors = opts?.log !== false
    const invalid = opts?.invalid ?? "ignore"

    const md = await ConfigMarkdown.parse(location).catch((err) => {
      if (logErrors) {
        log.error("failed to load runtime skill", { skill: location, err })
      }
      if (invalid === "throw") {
        throw new InvalidError({
          path: location,
          message: `Invalid skill frontmatter in ${location}`,
        })
      }
      return undefined
    })
    if (!md) return

    const parsed = parseInfo(location, md)
    if (!parsed.success) {
      if (logErrors) {
        log.warn("invalid runtime skill metadata", { skill: location, issues: parsed.error.issues })
      }
      if (invalid === "throw") {
        throw new InvalidError({
          path: location,
          message: `Invalid skill frontmatter in ${location}`,
          issues: parsed.error.issues,
        })
      }
      return
    }

    return parsed.info
  }

  const scanRuntimeOverlay = async (root: string, file?: string) => {
    const matches = file
      ? [file]
      : await Glob.scan(SKILL_PATTERN, {
          cwd: root,
          absolute: true,
          include: "file",
          symlink: true,
        })

    const loaded = await Promise.all(matches.map((match) => parseRuntimeInfo(match)))
    const skills = new Map<string, Info>()
    for (const skill of loaded) {
      if (!skill) continue
      skills.set(skill.name, skill)
    }
    return skills
  }

  const runtimeOverlayState = (): RuntimeOverlayState => ({
    sources: new Map<string, RuntimeSourceState>(),
  })

  const runtimeScopeKey = (scope: Exclude<RuntimeScopeName, "discovered">, input: RuntimeScope) => {
    if (!input.workspaceID) {
      throw new Error(`${scope} scope requires workspaceID`)
    }

    if (scope === "workspace") {
      return `${input.workspaceID}`
    }

    if (!input.sessionID) {
      throw new Error("session scope requires sessionID")
    }

    return `${input.workspaceID}:${input.sessionID}`
  }

  const mergeOverlay = (base: Map<string, Info>, overlay?: RuntimeOverlayState) => {
    const merged = new Map(base)
    if (!overlay) return merged

    for (const source of overlay.sources.values()) {
      for (const hidden of source.hidden) {
        merged.delete(hidden)
      }

      for (const [name, info] of source.skills) {
        merged.set(name, info)
      }
    }

    return merged
  }

  const runtimeSourceKey = (params: RuntimeLoadInput) => params.file ?? params.root

  const mergeOverlays = (base: Map<string, Info>, overlays: RuntimeOverlayState[]) => {
    let result = new Map(base)
    for (const overlay of overlays) {
      result = mergeOverlay(result, overlay)
    }
    return result
  }

  export function runtimeOverlay(input?: { discovered?: Info[] }): RuntimeOverlay {
    const discovered = new Map((input?.discovered ?? []).map((skill) => [skill.name, skill] as const))
    const discoveredRoots = new Map<string, Map<string, Info>>()
    const workspace = new Map<string, RuntimeOverlayState>()
    const session = new Map<string, RuntimeOverlayState>()

    const overlayFor = (scope: Exclude<RuntimeScopeName, "discovered">, target: RuntimeScope) => {
      const key = runtimeScopeKey(scope, target)
      const table = scope === "workspace" ? workspace : session
      let overlay = table.get(key)
      if (!overlay) {
        overlay = runtimeOverlayState()
        table.set(key, overlay)
      }
      return overlay
    }

    const merged = (scope?: RuntimeScope, opts?: { includeHidden?: boolean }) => {
      let merged = new Map(discovered)
      if (!scope?.workspaceID) return merged

      merged = mergeOverlay(merged, workspace.get(runtimeScopeKey("workspace", scope)))
      if (!scope.sessionID) return merged

      return mergeOverlay(merged, session.get(runtimeScopeKey("session", scope)))
    }

    const mergedForSession = (scope: RuntimeScope) => {
      let result = new Map(discovered)
      if (scope.workspaceID) {
        result = mergeOverlay(result, workspace.get(runtimeScopeKey("workspace", scope)))
        result = mergeOverlay(result, session.get(runtimeScopeKey("session", scope)))
        return result
      }

      const overlays = [...session.entries()]
        .filter(([key]) => key.endsWith(`:${scope.sessionID}`))
        .map(([, overlay]) => overlay)
      return mergeOverlays(result, overlays)
    }

    const allKnown = (scope?: RuntimeScope) => {
      let result = new Map(discovered)
      if (!scope?.workspaceID) return result

      const workspaceState = workspace.get(runtimeScopeKey("workspace", scope))
      if (workspaceState) {
        for (const source of workspaceState.sources.values()) {
          for (const [name, info] of source.skills) {
            result.set(name, info)
          }
        }
      }

      if (!scope.sessionID) return result

      const sessionState = session.get(runtimeScopeKey("session", scope))
      if (sessionState) {
        for (const source of sessionState.sources.values()) {
          for (const [name, info] of source.skills) {
            result.set(name, info)
          }
        }
      }

      return result
    }

    const allKnownForSession = (scope: RuntimeScope) => {
      let result = new Map(discovered)
      if (scope.workspaceID) {
        const workspaceState = workspace.get(runtimeScopeKey("workspace", scope))
        if (workspaceState) {
          for (const source of workspaceState.sources.values()) {
            for (const [name, info] of source.skills) {
              result.set(name, info)
            }
          }
        }

        const sessionState = session.get(runtimeScopeKey("session", scope))
        if (sessionState) {
          for (const source of sessionState.sources.values()) {
            for (const [name, info] of source.skills) {
              result.set(name, info)
            }
          }
        }
        return result
      }

      for (const [key, overlay] of session) {
        if (!key.endsWith(`:${scope.sessionID}`)) continue
        for (const source of overlay.sources.values()) {
          for (const [name, info] of source.skills) {
            result.set(name, info)
          }
        }
      }
      return result
    }

    return {
      load: async (params: RuntimeLoadInput) => {
        const skills =
          !params.file && (params.hide?.length ?? 0) > 0 && !(await Filesystem.exists(params.root))
            ? new Map<string, Info>()
            : await scanRuntimeOverlay(params.root, params.file)

        if (params.scope === "discovered") {
          for (const [root, source] of discoveredRoots) {
            if (root === params.root) continue

            for (const name of skills.keys()) {
              if (source.has(name)) {
                throw new Error(`discovered overlay collision for skill ${name}`)
              }
            }
          }

          const previous = discoveredRoots.get(params.root)
          if (previous) {
            for (const name of previous.keys()) {
              discovered.delete(name)
            }
          }

          discoveredRoots.set(params.root, skills)
          for (const [name, info] of skills) {
            discovered.set(name, info)
          }
          return
        }

        const overlay = overlayFor(params.scope, params)
        const sourceKey = runtimeSourceKey(params)
        for (const [root, source] of overlay.sources) {
          if (root === sourceKey) continue

          for (const name of skills.keys()) {
            if (source.skills.has(name)) {
              throw new Error(`${params.scope} overlay collision for skill ${name}`)
            }
          }
        }

        const previous = overlay.sources.get(sourceKey)
        const nextSkills = new Map(skills)

        const nextHidden = new Set(previous?.hidden ?? [])
        for (const name of params.hide ?? []) {
          nextHidden.add(name)
        }

        overlay.sources.set(sourceKey, {
          skills: nextSkills,
          hidden: nextHidden,
        })
      },
      unload: async (params: RuntimeUnloadInput) => {
        const names = new Set(params.names ?? [])

        if (params.scope === "discovered") {
          if (names.size === 0) {
            discovered.clear()
            discoveredRoots.clear()
            return
          }

          for (const name of names) {
            discovered.delete(name)
          }

          for (const [root, source] of discoveredRoots) {
            for (const name of names) {
              source.delete(name)
            }

            if (source.size === 0) {
              discoveredRoots.delete(root)
            }
          }
          return
        }

        const overlay = overlayFor(params.scope, params)
        if (names.size === 0) {
          overlay.sources.clear()
          return
        }

        for (const source of overlay.sources.values()) {
          for (const name of names) {
            source.skills.delete(name)
            source.hidden.delete(name)
          }
        }

        for (const [root, source] of overlay.sources) {
          if (source.skills.size === 0 && source.hidden.size === 0) {
            overlay.sources.delete(root)
          }
        }
      },
      all: async (scope?: RuntimeScope, opts?: { includeHidden?: boolean }) =>
        Array.from(
          (
            scope?.sessionID && !scope.workspaceID
              ? opts?.includeHidden
                ? allKnownForSession(scope)
                : mergedForSession(scope)
              : opts?.includeHidden
                ? allKnown(scope)
                : merged(scope)
          ).values(),
        ).toSorted((a, b) => a.name.localeCompare(b.name)),
      get: async (name: string, scope?: RuntimeScope, opts?: { includeHidden?: boolean }) =>
        (
          scope?.sessionID && !scope.workspaceID
            ? opts?.includeHidden
              ? allKnownForSession(scope)
              : mergedForSession(scope)
            : opts?.includeHidden
              ? allKnown(scope)
              : merged(scope)
        ).get(name),
    }
  }

  export async function runtimeLoad(input: RuntimeLoadInput) {
    return runtimeState().load(input)
  }

  export async function runtimeUnload(input: RuntimeUnloadInput) {
    return runtimeState().unload(input)
  }

  export async function runtimeAll(scope?: RuntimeScope, opts?: { includeHidden?: boolean }) {
    return runtimeState().all(scope, opts)
  }

  export async function runtimeGet(name: string, scope?: RuntimeScope, opts?: { includeHidden?: boolean }) {
    return runtimeState().get(name, scope, opts)
  }

  // TODO: Migrate to Effect
  const create = (discovery: Discovery.Interface, directory: string, worktree: string): Cache => {
    const state: State = {
      skills: {},
      dirs: new Set<string>(),
    }

    const load = async () => {
      if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
        for (const dir of EXTERNAL_DIRS) {
          const root = path.join(Global.Path.home, dir)
          if (!(await Filesystem.isDir(root))) continue
          await scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
        }

        for await (const root of Filesystem.up({
          targets: EXTERNAL_DIRS,
          start: directory,
          stop: worktree,
        })) {
          await scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
        }
      }

      // Config.directories() not available in reaslab-agent
      // for (const dir of await Config.directories()) {
      //   await scan(state, dir, OPENCODE_SKILL_PATTERN)
      // }

      const cfg = Config.get()
      for (const item of cfg.skills?.paths ?? []) {
        const expanded = item.startsWith("~/") ? path.join(os.homedir(), item.slice(2)) : item
        const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
        if (!(await Filesystem.isDir(dir))) continue

        await scan(state, dir, SKILL_PATTERN)
      }

      for (const url of cfg.skills?.urls ?? []) {
        for (const dir of await Effect.runPromise(discovery.pull(url))) {
          state.dirs.add(dir)
          await scan(state, dir, SKILL_PATTERN)
        }
      }

      log.info("init", { count: Object.keys(state.skills).length })
    }

    const ensure = () => {
      if (state.task) return state.task
      state.task = load().catch((err) => {
        state.task = undefined
        throw err
      })
      return state.task
    }

    return { ...state, ensure }
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Skill") {}

  export const layer: Layer.Layer<Service, never, Discovery.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const discovery = yield* Discovery.Service
      const state = yield* InstanceState.make(
        Effect.fn("Skill.state")((ctx) => Effect.sync(() => create(discovery, ctx.directory, ctx.worktree))),
      )

      const ensure = Effect.fn("Skill.ensure")(function* () {
        const cache = yield* InstanceState.get(state)
        yield* Effect.promise(() => cache.ensure())
        return cache
      })

      const get = Effect.fn("Skill.get")(function* (name: string) {
        const cache = yield* ensure()
        return cache.skills[name]
      })

      const all = Effect.fn("Skill.all")(function* () {
        const cache = yield* ensure()
        return Object.values(cache.skills)
      })

      const dirs = Effect.fn("Skill.dirs")(function* () {
        const cache = yield* ensure()
        return Array.from(cache.dirs)
      })

      const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
        const cache = yield* ensure()
        const list = Object.values(cache.skills).toSorted((a, b) => a.name.localeCompare(b.name))
        if (!agent) return list
        return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
      })

      return Service.of({ get, all, dirs, available })
    }),
  )

  export const defaultLayer: Layer.Layer<Service> = layer.pipe(Layer.provide(Discovery.defaultLayer))

  export function fmt(list: Info[], opts: { verbose: boolean }) {
    if (list.length === 0) return "No skills are currently available."

    if (opts.verbose) {
      return [
        "<available_skills>",
        ...list.flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
        "</available_skills>",
      ].join("\n")
    }

    return ["## Available Skills", ...list.map((skill) => `- **${skill.name}**: ${skill.description}`)].join("\n")
  }

  const runPromise = makeRunPromise(Service, defaultLayer)

  export async function get(name: string) {
    return runPromise((skill) => skill.get(name))
  }

  export async function all() {
    return runPromise((skill) => skill.all())
  }

  export async function dirs() {
    return runPromise((skill) => skill.dirs())
  }

  export async function available(agent?: Agent.Info) {
    return runPromise((skill) => skill.available(agent))
  }
}
