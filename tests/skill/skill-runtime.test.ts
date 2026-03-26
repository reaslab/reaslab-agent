import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Skill } from "../../src/skill/index"
import { WorkspaceID } from "../../src/control-plane/schema"
import { SessionID } from "../../src/session/schema"

type Scope = "discovered" | "workspace" | "session"

type RuntimeScope = {
  workspaceID?: WorkspaceID
  sessionID?: SessionID
}

type LoadInput = RuntimeScope & {
  scope: Scope
  root: string
  hide?: string[]
}

type UnloadInput = RuntimeScope & {
  scope: Scope
  names?: string[]
}

type RuntimeApi = {
  load(input: LoadInput): Promise<void>
  unload(input: UnloadInput): Promise<void>
  all(scope?: RuntimeScope): Promise<Skill.Info[]>
  get(name: string, scope?: RuntimeScope): Promise<Skill.Info | undefined>
}

const workspaceID = WorkspaceID.make("workspace_01")
const sessionA = SessionID.make("session_01")
const sessionB = SessionID.make("session_02")

function createRuntime(base: Skill.Info[] = []): RuntimeApi {
  return Skill.runtimeOverlay({ discovered: base }) as RuntimeApi
}

function skillInfo(name: string, description: string, location: string, content: string): Skill.Info {
  return {
    name,
    description,
    location,
    content,
  }
}

async function writeSkill(root: string, dirname: string, input: { name: string; description: string; body: string }) {
  const dir = path.join(root, dirname)
  const location = path.join(dir, "SKILL.md")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    location,
    [
      "---",
      `name: ${input.name}`,
      `description: ${input.description}`,
      "---",
      "",
      input.body,
      "",
    ].join("\n"),
  )
  return location
}

function names(list: Skill.Info[]) {
  return list.map((item) => item.name).toSorted()
}

describe("Skill runtime overlays", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    tempDirs.length = 0
  })

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test("workspace overlay takes precedence over discovered skills", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const discovered = [
      skillInfo("base-only", "discovered base", path.join(root, "base-only", "SKILL.md"), "Base only content"),
      skillInfo("shared", "discovered shared", path.join(root, "shared", "SKILL.md"), "Discovered shared content"),
    ]
    const overlayLocation = await writeSkill(root, "workspace-shared", {
      name: "shared",
      description: "workspace shared",
      body: "Workspace overlay content",
    })

    const runtime = createRuntime(discovered)
    await runtime.load({
      scope: "workspace",
      workspaceID,
      root,
    })

    const available = await runtime.all({ workspaceID })
    const shared = await runtime.get("shared", { workspaceID })

    expect(names(available)).toEqual(["base-only", "shared"])
    expect(shared?.location).toBe(overlayLocation)
    expect(shared?.description).toBe("workspace shared")
    expect(shared?.content).toContain("Workspace overlay content")
  })

  test("hiding a discovered skill leaves the discovered list unchanged", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const discovered = [
      skillInfo("hidden-base", "discovered hidden base", path.join(root, "hidden-base", "SKILL.md"), "Hidden base"),
      skillInfo("visible-base", "discovered visible base", path.join(root, "visible-base", "SKILL.md"), "Visible base"),
    ]

    const runtime = createRuntime(discovered)
    await runtime.load({
      scope: "workspace",
      workspaceID,
      root,
      hide: ["hidden-base"],
    })

    const available = await runtime.all({ workspaceID })
    const discoveredView = await runtime.all()

    expect(names(available)).toEqual(["visible-base"])
    expect(names(discoveredView)).toEqual(["hidden-base", "visible-base"])
  })

  test("reloading the same workspace scope preserves previous hidden state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const discovered = [
      skillInfo("alpha", "alpha base", path.join(root, "alpha", "SKILL.md"), "Alpha"),
      skillInfo("beta", "beta base", path.join(root, "beta", "SKILL.md"), "Beta"),
    ]

    const runtime = createRuntime(discovered)
    await runtime.load({
      scope: "workspace",
      workspaceID,
      root,
      hide: ["alpha"],
    })

    expect(names(await runtime.all({ workspaceID }))).toEqual(["beta"])

    await runtime.load({
      scope: "workspace",
      workspaceID,
      root,
    })

    expect(names(await runtime.all({ workspaceID }))).toEqual(["beta"])
  })

  test("repeatedly loading the same overlay is idempotent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const discovered = [skillInfo("alpha", "alpha base", path.join(root, "alpha", "SKILL.md"), "Alpha")]
    const overlayLocation = await writeSkill(root, "workspace-alpha", {
      name: "alpha",
      description: "alpha overlay",
      body: "Alpha overlay body",
    })

    const runtime = createRuntime(discovered)
    await runtime.load({ scope: "workspace", workspaceID, root })
    await runtime.load({ scope: "workspace", workspaceID, root })

    const available = await runtime.all({ workspaceID })
    const alpha = await runtime.get("alpha", { workspaceID })

    expect(available).toHaveLength(1)
    expect(names(available)).toEqual(["alpha"])
    expect(alpha?.location).toBe(overlayLocation)
    expect(alpha?.description).toBe("alpha overlay")
  })

  test("loading a colliding skill into the same workspace scope fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const firstRoot = path.join(root, "first")
    const secondRoot = path.join(root, "second")
    await writeSkill(firstRoot, "shared-a", {
      name: "shared",
      description: "shared first",
      body: "First shared body",
    })
    await writeSkill(secondRoot, "shared-b", {
      name: "shared",
      description: "shared second",
      body: "Second shared body",
    })

    const runtime = createRuntime()
    await runtime.load({ scope: "workspace", workspaceID, root: firstRoot })

    await expect(runtime.load({ scope: "workspace", workspaceID, root: secondRoot })).rejects.toThrow(
      /workspace.*shared|shared.*workspace/i,
    )
  })

  test("a discovered skill can be unloaded and reloaded to refresh its content", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const location = await writeSkill(root, "shared", {
      name: "shared",
      description: "discovered v1",
      body: "Discovered version one",
    })

    const runtime = createRuntime()
    await runtime.load({ scope: "discovered", root })

    expect((await runtime.get("shared"))?.content).toContain("version one")

    await runtime.unload({ scope: "discovered", names: ["shared"] })
    await fs.writeFile(
      location,
      ["---", "name: shared", "description: discovered v2", "---", "", "Discovered version two", ""].join("\n"),
    )
    await runtime.load({ scope: "discovered", root })

    const shared = await runtime.get("shared")
    expect(shared?.description).toBe("discovered v2")
    expect(shared?.content).toContain("version two")
  })

  test("reloading a discovered root removes skills that disappeared on disk", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const alphaDir = path.join(root, "alpha")
    const betaDir = path.join(root, "beta")
    await writeSkill(root, "alpha", {
      name: "alpha",
      description: "alpha skill",
      body: "Alpha body",
    })
    await writeSkill(root, "beta", {
      name: "beta",
      description: "beta skill",
      body: "Beta body",
    })

    const runtime = createRuntime()
    await runtime.load({ scope: "discovered", root })
    expect(names(await runtime.all())).toEqual(["alpha", "beta"])

    await fs.rm(betaDir, { recursive: true, force: true })
    await runtime.load({ scope: "discovered", root })

    expect(names(await runtime.all())).toEqual(["alpha"])
    expect(await runtime.get("beta")).toBeUndefined()
    await fs.rm(alphaDir, { recursive: true, force: true })
  })

  test("loading colliding discovered roots fails explicitly", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const firstRoot = path.join(root, "first")
    const secondRoot = path.join(root, "second")
    await writeSkill(firstRoot, "shared-a", {
      name: "shared",
      description: "shared first",
      body: "First shared body",
    })
    await writeSkill(secondRoot, "shared-b", {
      name: "shared",
      description: "shared second",
      body: "Second shared body",
    })

    const runtime = createRuntime()
    await runtime.load({ scope: "discovered", root: firstRoot })

    await expect(runtime.load({ scope: "discovered", root: secondRoot })).rejects.toThrow(
      /discovered.*shared|shared.*discovered/i,
    )
  })

  test("session-scoped overlays are visible only to the owning session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const discovered = [skillInfo("base", "base skill", path.join(root, "base", "SKILL.md"), "Base content")]
    await writeSkill(root, "session-only", {
      name: "session-only",
      description: "session scoped skill",
      body: "Visible to one session only",
    })

    const runtime = createRuntime(discovered)
    await runtime.load({
      scope: "session",
      workspaceID,
      sessionID: sessionA,
      root,
      hide: ["base"],
    })

    expect(names(await runtime.all({ workspaceID, sessionID: sessionA }))).toEqual(["session-only"])
    expect(names(await runtime.all({ workspaceID, sessionID: sessionB }))).toEqual(["base"])
    expect(names(await runtime.all({ workspaceID }))).toEqual(["base"])
  })

  test("runtime loading ignores invalid skill files and keeps valid ones", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    await writeSkill(root, "valid", {
      name: "valid",
      description: "valid skill",
      body: "Valid skill body",
    })

    const invalidDir = path.join(root, "invalid")
    await fs.mkdir(invalidDir, { recursive: true })
    await fs.writeFile(path.join(invalidDir, "SKILL.md"), ["---", "name: invalid", "---", "", "Missing description", ""].join("\n"))

    const runtime = createRuntime()
    await runtime.load({ scope: "discovered", root })

    expect(names(await runtime.all())).toEqual(["valid"])
    expect(await runtime.get("invalid")).toBeUndefined()
  })

  test("parseRuntimeInfo keeps shared metadata parsing aligned with discovered skill loading", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-"))
    tempDirs.push(root)

    const location = await writeSkill(root, "runtime-shared-parse", {
      name: "runtime-shared-parse",
      description: "shared parser skill",
      body: "Shared parser body",
    })

    const parsed = await Skill.parseRuntimeInfo(location)
    const runtime = createRuntime()
    await runtime.load({ scope: "discovered", root })
    const loaded = await runtime.get("runtime-shared-parse")

    expect(parsed).toEqual(loaded)
  })
})
