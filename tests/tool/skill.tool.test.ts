import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Boot } from "../../src/boot"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { SkillTool } from "../../src/tool/skill"

const workspace = path.resolve(import.meta.dir, "../..")
const sessionID = SessionID.make("ses_skill_tool_mathflow")
const messageID = MessageID.make("msg_skill_tool_mathflow")

describe("SkillTool", () => {
  beforeEach(() => {
    Config.reset()
    Boot.reset()
  })

  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("loads the named mathflow skill and returns skill content", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const tool = await SkillTool.init()
        const permissionRequests: Record<string, unknown>[] = []

        const result = await tool.execute(
          { name: "mathflow" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            async ask(request) {
              permissionRequests.push(request as Record<string, unknown>)
            },
          },
        )

        expect(result.title).toBe("Loaded skill: mathflow")
        expect(result.output).toContain("<skill_content name=\"mathflow\">")
        expect(result.output).toContain("# Skill: mathflow")
        expect(result.output).toContain("Use when")
        expect(result.output).toContain("problem-analysis")
        expect(result.metadata.name).toBe("mathflow")
        expect(result.metadata.dir).toBe(path.join(workspace, "skills", "mathflow"))
        expect(permissionRequests).toHaveLength(1)
        expect(permissionRequests[0]).toMatchObject({
          permission: "skill",
          patterns: ["mathflow"],
          always: ["mathflow"],
        })
      },
    })
  })
})
