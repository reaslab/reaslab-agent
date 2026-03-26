import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Boot } from "../../src/boot"
import { Config } from "../../src/config/config"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { Skill } from "../../src/skill"
import { createTempRuntime, withRuntime, writeSkill } from "../helpers/runtime-skill"

const workspaceID = WorkspaceID.make("wrk_prompt_command_runtime")
const sessionA = SessionID.make("ses_prompt_command_runtime_a")
const sessionB = SessionID.make("ses_prompt_command_runtime_b")
const messageID = MessageID.make("msg_prompt_command_runtime")

type PromptResult = Awaited<ReturnType<typeof SessionPrompt.prompt>>
type PromptInput = Parameters<typeof SessionPrompt.prompt>[0]
type CommandInput = Parameters<typeof SessionPrompt.command>[0]

async function withPromptCapture<T>(run: (captured: PromptInput[]) => Promise<T>) {
  const captured: PromptInput[] = []
  const originalPrompt = SessionPrompt.prompt
  SessionPrompt.prompt = async (input) => {
    captured.push(input)
    return {
      info: { id: messageID } as PromptResult["info"],
      parts: input.parts,
    } as PromptResult
  }

  try {
    return await run(captured)
  } finally {
    SessionPrompt.prompt = originalPrompt
  }
}

describe("SessionPrompt command runtime skill resolution", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    Config.reset()
    Boot.reset()
  })

  afterEach(async () => {
    await Instance.disposeAll()
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test("prompt command execution uses session-aware command resolution", async () => {
    const runtime = await createTempRuntime("prompt-command-runtime-")
    tempDirs.push(runtime.root)
    const skillFile = await writeSkill(runtime.sessionRoot, "session-command", "session command skill", "Session scoped command body")

    await withRuntime(runtime.root, async () => {
      await Skill.runtimeLoad({
        scope: "session",
        root: path.dirname(skillFile),
        file: skillFile,
        workspaceID,
        sessionID: sessionA,
      })

      await withPromptCapture(async (captured) => {
        const owningCommand: CommandInput = {
          sessionID: sessionA,
          messageID,
          command: "session-command",
          arguments: "",
          agent: "build",
          model: "reaslab/default",
        }

        const otherSessionCommand: CommandInput = {
          sessionID: sessionB,
          messageID,
          command: "session-command",
          arguments: "",
          agent: "build",
          model: "reaslab/default",
        }

        await SessionPrompt.command(owningCommand)

        await expect(SessionPrompt.command(otherSessionCommand)).rejects.toThrow(/Command not found: "session-command"/)

        expect(captured).toHaveLength(1)
        expect(captured[0]?.parts.some((part) => part.type === "text" && part.text.includes("Session scoped command body"))).toBe(true)
      })
    })
  })

  test("prompt command execution does not let runtime skills override built-in commands", async () => {
    const runtime = await createTempRuntime("prompt-command-runtime-")
    tempDirs.push(runtime.root)
    const skillFile = await writeSkill(runtime.sessionRoot, "init", "conflicting init skill", "Conflicting init body")

    await withRuntime(runtime.root, async () => {
      const baselineCaptured: PromptInput[] = []
      await withPromptCapture(async (captured) => {
        await SessionPrompt.command({
          sessionID: sessionA,
          messageID,
          command: "init",
          arguments: "",
          agent: "build",
          model: "reaslab/default",
        })

        baselineCaptured.push(...captured)
      })

      await Skill.runtimeLoad({
        scope: "session",
        root: path.dirname(skillFile),
        file: skillFile,
        workspaceID,
        sessionID: sessionA,
      })

      await withPromptCapture(async (captured) => {
        await SessionPrompt.command({
          sessionID: sessionA,
          messageID,
          command: "init",
          arguments: "",
          agent: "build",
          model: "reaslab/default",
        })

        expect(captured).toHaveLength(1)
        expect(captured[0]?.parts).toEqual(baselineCaptured[0]?.parts)
      })
    })
  })
})
