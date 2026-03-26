import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Boot } from "../../src/boot"
import { Config } from "../../src/config/config"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { SystemPrompt } from "../../src/session/system"
import { Skill } from "../../src/skill"
import { createTempRuntime, withRuntime, writeSkill } from "../helpers/runtime-skill"

const workspaceID = WorkspaceID.make("wrk_system_runtime")
const sessionA = SessionID.make("ses_system_runtime_a")
const sessionB = SessionID.make("ses_system_runtime_b")

type SessionScope = {
  workspaceID: WorkspaceID
  sessionID: SessionID
}

async function systemSkills(agent: NonNullable<Awaited<ReturnType<typeof Agent.get>>>, scope: SessionScope) {
  return Reflect.apply(
    SystemPrompt.skills as (...args: unknown[]) => ReturnType<typeof SystemPrompt.skills>,
    SystemPrompt,
    [agent, scope],
  )
}

describe("SystemPrompt runtime skill visibility", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    Config.reset()
    Boot.reset()
  })

  afterEach(async () => {
    await Instance.disposeAll()
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test("skill exposure becomes session-aware", async () => {
    const runtime = await createTempRuntime("system-runtime-")
    tempDirs.push(runtime.root)
    const sessionSkill = await writeSkill(runtime.sessionRoot, "session-visible-skill", "visible only in one session")
    await writeSkill(runtime.discoveredRoot, "shared-hidden-skill", "shared skill hidden in one session")

    await withRuntime(runtime.root, async () => {
      await Skill.runtimeLoad({
        scope: "discovered",
        root: runtime.discoveredRoot,
      })
      await Skill.runtimeLoad({
        scope: "session",
        root: path.dirname(sessionSkill),
        file: sessionSkill,
        workspaceID,
        sessionID: sessionA,
      })
      await Skill.runtimeLoad({
        scope: "session",
        root: runtime.hiddenRoot,
        hide: ["shared-hidden-skill"],
        workspaceID,
        sessionID: sessionA,
      })

      const agent = (await Agent.get("build"))!
      const visiblePrompt = await systemSkills(agent, {
        workspaceID,
        sessionID: sessionA,
      })
      const otherPrompt = await systemSkills(agent, {
        workspaceID,
        sessionID: sessionB,
      })

      expect(visiblePrompt).toContain("session-visible-skill")
      expect(visiblePrompt).not.toContain("shared-hidden-skill")
      expect(otherPrompt).not.toContain("session-visible-skill")
      expect(otherPrompt).toContain("shared-hidden-skill")
    })
  })
})
