import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Boot } from "../../src/boot"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { Skill } from "../../src/skill"
import { createTempRuntime, withRuntime, writeSkill } from "../helpers/runtime-skill"

const workspaceID = WorkspaceID.make("wrk_command_runtime")
const sessionA = SessionID.make("ses_command_runtime_a")
const sessionB = SessionID.make("ses_command_runtime_b")

type SessionScope = {
  workspaceID: WorkspaceID
  sessionID: SessionID
}

async function getCommand(name: string, scope: SessionScope) {
  return Reflect.apply(Command.get as (...args: unknown[]) => ReturnType<typeof Command.get>, Command, [name, scope])
}

async function listCommands(scope: SessionScope) {
  return Reflect.apply(Command.list as (...args: unknown[]) => ReturnType<typeof Command.list>, Command, [scope])
}

describe("Command runtime skill resolution", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    Config.reset()
    Boot.reset()
  })

  afterEach(async () => {
    await Instance.disposeAll()
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test("session-loaded skills appear in command lookup and list only for the owning session", async () => {
    const runtime = await createTempRuntime("command-runtime-")
    tempDirs.push(runtime.root)
    const skillFile = await writeSkill(runtime.sessionRoot, "session-only-skill", "session-scoped command")

    await withRuntime(runtime.root, async () => {
      await Skill.runtimeLoad({
        scope: "session",
        root: path.dirname(skillFile),
        file: skillFile,
        workspaceID,
        sessionID: sessionA,
      })

      const sessionCommand = await getCommand("session-only-skill", {
        workspaceID,
        sessionID: sessionA,
      })
      const sessionList = await listCommands({
        workspaceID,
        sessionID: sessionA,
      })
      const otherSessionCommand = await getCommand("session-only-skill", {
        workspaceID,
        sessionID: sessionB,
      })
      const otherSessionList = await listCommands({
        workspaceID,
        sessionID: sessionB,
      })

      expect(sessionCommand?.source).toBe("skill")
      expect(sessionList.some((command) => command.name === "session-only-skill")).toBe(true)
      expect(otherSessionCommand).toBeUndefined()
      expect(otherSessionList.some((command) => command.name === "session-only-skill")).toBe(false)
    })
  })

  test("session-hidden skills disappear from command lookup and list only for that session", async () => {
    const runtime = await createTempRuntime("command-runtime-")
    tempDirs.push(runtime.root)
    await writeSkill(runtime.discoveredRoot, "shared-runtime-skill", "shared runtime command")

    await withRuntime(runtime.root, async () => {
      await Skill.runtimeLoad({
        scope: "discovered",
        root: runtime.discoveredRoot,
      })
      await Skill.runtimeLoad({
        scope: "session",
        root: runtime.hiddenRoot,
        hide: ["shared-runtime-skill"],
        workspaceID,
        sessionID: sessionA,
      })

      const hiddenCommand = await getCommand("shared-runtime-skill", {
        workspaceID,
        sessionID: sessionA,
      })
      const hiddenList = await listCommands({
        workspaceID,
        sessionID: sessionA,
      })
      const visibleCommand = await getCommand("shared-runtime-skill", {
        workspaceID,
        sessionID: sessionB,
      })
      const visibleList = await listCommands({
        workspaceID,
        sessionID: sessionB,
      })

      expect(hiddenCommand).toBeUndefined()
      expect(hiddenList.some((command) => command.name === "shared-runtime-skill")).toBe(false)
      expect(visibleCommand?.source).toBe("skill")
      expect(visibleList.some((command) => command.name === "shared-runtime-skill")).toBe(true)
    })
  })

  test("runtime skill conflicts do not override built-in commands", async () => {
    const runtime = await createTempRuntime("command-runtime-")
    tempDirs.push(runtime.root)
    const skillFile = await writeSkill(runtime.sessionRoot, "init", "conflicting runtime skill", "Conflicting init body")

    await withRuntime(runtime.root, async () => {
      const baseline = await Command.get("init")

      await Skill.runtimeLoad({
        scope: "session",
        root: path.dirname(skillFile),
        file: skillFile,
        workspaceID,
        sessionID: sessionA,
      })

      const command = await getCommand("init", {
        workspaceID,
        sessionID: sessionA,
      })

      expect(command?.source).toBe("command")
      expect(command?.description).toBe(baseline?.description)
      expect(await command?.template).toBe(await baseline?.template)
    })
  })
})
