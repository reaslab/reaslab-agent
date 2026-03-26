import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Boot } from "../../src/boot"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { Skill } from "../../src/skill"
import { SkillTool } from "../../src/tool/skill"

const workspace = path.resolve(import.meta.dir, "../..")
const mathflowPath = path.join(workspace, "skills", "mathflow", "SKILL.md")
const problemAnalysisPath = path.join(workspace, "skills", "problem-analysis", "SKILL.md")
const mathematicalModelingPath = path.join(workspace, "skills", "mathematical-modeling", "SKILL.md")
const derivationAndProofCheckingPath = path.join(workspace, "skills", "derivation-and-proof-checking", "SKILL.md")
const researchPlanningPath = path.join(workspace, "skills", "research-planning", "SKILL.md")
const selfAuditLoopPath = path.join(workspace, "skills", "self-audit-loop", "SKILL.md")
const numericalExperimentationPath = path.join(workspace, "skills", "numerical-experimentation", "SKILL.md")
const resultValidationPath = path.join(workspace, "skills", "result-validation", "SKILL.md")
const reportWritingPath = path.join(workspace, "skills", "report-writing", "SKILL.md")
const sessionID = SessionID.make("ses_repository_skill_bundle")
const messageID = MessageID.make("msg_repository_skill_bundle")

describe("repository skill bundle", () => {
  beforeEach(() => {
    Config.reset()
    Boot.reset()
  })

  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("repository bundle exposes mathflow", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const available = await Skill.available()
        const mathflow = available.find((skill) => skill.name === "mathflow")

        expect(mathflow).toBeDefined()
        expect(mathflow?.location).toBe(mathflowPath)

        const tool = await SkillTool.init()
        const result = await tool.execute(
          { name: "mathflow" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.output).toContain("<skill_content name=\"mathflow\">")
        expect(result.output).toContain("Base directory for this skill:")
        expect(result.metadata).toMatchObject({
          name: "mathflow",
          dir: path.dirname(mathflowPath),
        })
      },
    })
  })

  test("repository bundle exposes analysis and modeling stage skills", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const available = await Skill.available()
        const problemAnalysis = available.find((skill) => skill.name === "problem-analysis")
        const mathematicalModeling = available.find((skill) => skill.name === "mathematical-modeling")

        expect(problemAnalysis).toBeDefined()
        expect(problemAnalysis?.location).toBe(problemAnalysisPath)

        expect(mathematicalModeling).toBeDefined()
        expect(mathematicalModeling?.location).toBe(mathematicalModelingPath)

        const tool = await SkillTool.init()
        const result = await tool.execute(
          { name: "problem-analysis" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.output).toContain("<skill_content name=\"problem-analysis\">")
        expect(result.output).toContain("## Hard rules")
        expect(result.metadata).toMatchObject({
          name: "problem-analysis",
          dir: path.dirname(problemAnalysisPath),
        })
      },
    })
  })

  test("repository bundle exposes derivation and planning stage skills", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const available = await Skill.available()
        const derivation = available.find((skill) => skill.name === "derivation-and-proof-checking")
        const researchPlanning = available.find((skill) => skill.name === "research-planning")

        expect(derivation).toBeDefined()
        expect(derivation?.location).toBe(derivationAndProofCheckingPath)

        expect(researchPlanning).toBeDefined()
        expect(researchPlanning?.location).toBe(researchPlanningPath)

        const tool = await SkillTool.init()
        const result = await tool.execute(
          { name: "research-planning" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.output).toContain("<skill_content name=\"research-planning\">")
        expect(result.output).toContain("## Hard rules")
        expect(result.metadata).toMatchObject({
          name: "research-planning",
          dir: path.dirname(researchPlanningPath),
        })
      },
    })
  })

  test("repository bundle exposes the self audit stage skill", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const available = await Skill.available()
        const selfAuditLoop = available.find((skill) => skill.name === "self-audit-loop")

        expect(selfAuditLoop).toBeDefined()
        expect(selfAuditLoop?.location).toBe(selfAuditLoopPath)

        const tool = await SkillTool.init()
        const result = await tool.execute(
          { name: "self-audit-loop" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.output).toContain("<skill_content name=\"self-audit-loop\">")
        expect(result.output).toContain("## Hard rules")
        expect(result.metadata).toMatchObject({
          name: "self-audit-loop",
          dir: path.dirname(selfAuditLoopPath),
        })
      },
    })
  })

  test("repository bundle exposes experimentation and validation stage skills", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const available = await Skill.available()
        const numericalExperimentation = available.find((skill) => skill.name === "numerical-experimentation")
        const resultValidation = available.find((skill) => skill.name === "result-validation")

        expect(numericalExperimentation).toBeDefined()
        expect(numericalExperimentation?.location).toBe(numericalExperimentationPath)

        expect(resultValidation).toBeDefined()
        expect(resultValidation?.location).toBe(resultValidationPath)

        const tool = await SkillTool.init()
        const result = await tool.execute(
          { name: "result-validation" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.output).toContain("<skill_content name=\"result-validation\">")
        expect(result.output).toContain("## Hard rules")
        expect(result.metadata).toMatchObject({
          name: "result-validation",
          dir: path.dirname(resultValidationPath),
        })
      },
    })
  })

  test("repository-backed loaded skill content exposes second-wave validation handoffs", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const tool = await SkillTool.init()
        const mathflow = await tool.execute(
          { name: "mathflow" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )
        const resultValidation = await tool.execute(
          { name: "result-validation" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(mathflow.output).toContain("`result-validation` prepares work for audit")
        expect(mathflow.output).toContain("`self-audit-loop` is the final skepticism gate before `report-writing`")
        expect(mathflow.output).toContain("route back to `mathematical-modeling`, `derivation-and-proof-checking`, `research-planning`, or `numerical-experimentation`")
        expect(mathflow.output).toContain("selects the next needed stage skill on demand")
        expect(mathflow.output).toContain("one stage at a time")
        expect(mathflow.output).toContain("not an eager loader for the whole skill family")

        expect(resultValidation.output).toContain("special cases, limit cases, sensitivity checks, and consistency checks")
        expect(resultValidation.output).toContain("Hand off to `self-audit-loop` before strong final conclusions and `report-writing`.")
        expect(resultValidation.output).not.toContain("do not split it into a separate self-audit loop")
      },
    })
  })

  test("repository bundle exposes the reporting stage skill", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const available = await Skill.available()
        const reportWriting = available.find((skill) => skill.name === "report-writing")

        expect(reportWriting).toBeDefined()
        expect(reportWriting?.location).toBe(reportWritingPath)

        const tool = await SkillTool.init()
        const result = await tool.execute(
          { name: "report-writing" },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.timeout(30000),
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.output).toContain("<skill_content name=\"report-writing\">")
        expect(result.output).toContain("## Hard rules")
        expect(result.metadata).toMatchObject({
          name: "report-writing",
          dir: path.dirname(reportWritingPath),
        })
      },
    })
  })
})
