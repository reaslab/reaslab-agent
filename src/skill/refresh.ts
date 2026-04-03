import os from "os"
import path from "path"
import chokidar, { type FSWatcher } from "chokidar"
import type { Config } from "../config/config"
import { Skill } from "./index"
import { Log } from "../util/log"

type SkillsWatchState = {
  watcher: FSWatcher
  pathsKey: string
  debounceMs: number
  timer?: ReturnType<typeof setTimeout>
  pendingPath?: string
}

const log = Log.create({ service: "skill-refresh" })
const watchers = new Map<string, SkillsWatchState>()

export const DEFAULT_SKILLS_WATCH_IGNORED: RegExp[] = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
  /(^|[\\/])\.venv([\\/]|$)/,
  /(^|[\\/])venv([\\/]|$)/,
  /(^|[\\/])__pycache__([\\/]|$)/,
  /(^|[\\/])build([\\/]|$)/,
  /(^|[\\/])\.cache([\\/]|$)/,
]

const EXTERNAL_DIRS = [".claude", ".agents"]

function resolveWatchDirs(directory: string, config?: Config.SkillsConfig): string[] {
  const dirs = new Set<string>()

  // External skill dirs (home-based)
  for (const dir of EXTERNAL_DIRS) {
    dirs.add(path.join(os.homedir(), dir, "skills"))
  }

  // Project skills dir
  dirs.add(path.join(directory, "skills"))

  // Project-level .claude/skills and .agents/skills (walk from directory up to worktree root)
  for (const dir of EXTERNAL_DIRS) {
    dirs.add(path.join(directory, dir, "skills"))
  }

  // Built-in skills dir (packaged in Docker image at /app/skills)
  const builtinSkillsDir = path.resolve(__dirname, "..", "..", "skills")
  dirs.add(builtinSkillsDir)

  // Config paths
  for (const item of config?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(os.homedir(), item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    dirs.add(dir)
  }

  return Array.from(dirs).toSorted()
}

function isSkillFile(filePath: string): boolean {
  return path.basename(filePath) === "SKILL.md"
}

export function ensureSkillsWatcher(params: {
  directory: string
  worktree: string
  config?: Config.SkillsConfig
}) {
  const directory = params.directory.trim()
  if (!directory) return

  const watchEnabled = params.config?.watch !== false
  const debounceMsRaw = params.config?.watchDebounceMs
  const debounceMs =
    typeof debounceMsRaw === "number" && Number.isFinite(debounceMsRaw)
      ? Math.max(0, debounceMsRaw)
      : 250

  const existing = watchers.get(directory)

  if (!watchEnabled) {
    if (existing) {
      watchers.delete(directory)
      if (existing.timer) clearTimeout(existing.timer)
      void existing.watcher.close().catch(() => {})
    }
    return
  }

  const watchDirs = resolveWatchDirs(directory, params.config)
  const pathsKey = watchDirs.join("|")

  if (existing && existing.pathsKey === pathsKey && existing.debounceMs === debounceMs) {
    return
  }

  if (existing) {
    watchers.delete(directory)
    if (existing.timer) clearTimeout(existing.timer)
    void existing.watcher.close().catch(() => {})
  }

  const watcher = chokidar.watch(watchDirs, {
    ignoreInitial: true,
    ignored: DEFAULT_SKILLS_WATCH_IGNORED,
  })

  const state: SkillsWatchState = { watcher, pathsKey, debounceMs }

  const schedule = (changedPath?: string) => {
    state.pendingPath = changedPath ?? state.pendingPath
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      const pendingPath = state.pendingPath
      state.pendingPath = undefined
      state.timer = undefined
      log.info("SKILL.md changed, bumping version", { path: pendingPath })
      Skill.markNeedsReload(directory)
      try {
        Skill.bumpVersion()
      } catch {
        // bumpVersion() requires Instance context; outside it, the reload
        // flag alone is enough — ensure() will bump after re-scan.
      }
    }, debounceMs)
  }

  watcher.on("add", (p) => { if (isSkillFile(p)) schedule(p) })
  watcher.on("change", (p) => { if (isSkillFile(p)) schedule(p) })
  watcher.on("unlink", (p) => { if (isSkillFile(p)) schedule(p) })
  watcher.on("error", (err) => {
    log.warn(`skills watcher error (${directory}): ${String(err)}`)
  })

  watchers.set(directory, state)
}

export async function resetSkillsRefreshForTest(): Promise<void> {
  const active = Array.from(watchers.values())
  watchers.clear()
  await Promise.all(
    active.map(async (state) => {
      if (state.timer) clearTimeout(state.timer)
      try {
        await state.watcher.close()
      } catch {
        // Best-effort test cleanup
      }
    }),
  )
}
