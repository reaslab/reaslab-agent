import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Boot } from "../../src/boot"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Skill } from "../../src/skill"

describe("workspace skill discovery", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    Config.reset()
    Boot.reset()
  })

  afterEach(async () => {
    await Instance.disposeAll()
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test("Skill.available discovers workspace-local stage skills from the default skills directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-skill-"))
    tempDirs.push(root)

    const skills = [
      {
        name: "mathflow",
        description: "Use when mathematical work needs staged guidance.",
      },
      {
        name: "problem-analysis",
        description: "Use when the problem needs facts, assumptions, and success criteria separated.",
      },
      {
        name: "mathematical-modeling",
        description: "Use when the task needs variables, assumptions, and model selection.",
      },
      {
        name: "derivation-and-proof-checking",
        description: "Use when a derivation or proof attempt needs explicit justification boundaries.",
      },
      {
        name: "research-planning",
        description: "Use when numerical or experimental work needs an explicit objective and plan.",
      },
      {
        name: "numerical-experimentation",
        description: "Use when numerical work needs reproducible experiments, retained anomalies, and report-ready evidence.",
      },
      {
        name: "result-validation",
        description: "Use when numerical or analytical findings need limit checks, sensitivity checks, and an explicit audit before strong claims.",
      },
      {
        name: "report-writing",
        description: "Use when staged mathematical work needs a final writeup grounded in actual outputs, explicit uncertainty, and honest claim strength.",
      },
    ]

    await Promise.all(
      skills.map(async (skill) => {
        const file = path.join(root, "skills", skill.name, "SKILL.md")
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(
          file,
          [
            "---",
            `name: ${skill.name}`,
            `description: ${skill.description}`,
            "---",
            "",
            `${skill.name} body`,
            "",
          ].join("\n"),
        )
      }),
    )

    const available = await Instance.provide({
      directory: root,
      init: async () => {
        Config.reset()
        Boot.reset()
        await Boot.init(root)
      },
      fn: () => Skill.available(),
    })

    const discovered = available
      .filter((skill) => skills.some((candidate) => candidate.name === skill.name))
      .map((skill) => skill.name)
      .sort()

    expect(discovered).toEqual([
      "derivation-and-proof-checking",
      "mathematical-modeling",
      "mathflow",
      "numerical-experimentation",
      "problem-analysis",
      "report-writing",
      "research-planning",
      "result-validation",
    ])
  })

  test("Skill.available only uses the repository-local skills directory by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-skill-default-"))
    tempDirs.push(root)

    const defaultSkillFile = path.join(root, "skills", "mathflow", "SKILL.md")
    await fs.mkdir(path.dirname(defaultSkillFile), { recursive: true })
    await fs.writeFile(
      defaultSkillFile,
      [
        "---",
        "name: mathflow",
        "description: Use when mathematical work needs staged guidance.",
        "---",
        "",
        "mathflow body",
        "",
      ].join("\n"),
    )

    const ignoredSkillFile = path.join(root, "custom-skills", "shadow-mathflow", "SKILL.md")
    await fs.mkdir(path.dirname(ignoredSkillFile), { recursive: true })
    await fs.writeFile(
      ignoredSkillFile,
      [
        "---",
        "name: shadow-mathflow",
        "description: Should not load without an explicit config path.",
        "---",
        "",
        "shadow body",
        "",
      ].join("\n"),
    )

    const available = await Instance.provide({
      directory: root,
      init: async () => {
        Config.reset()
        Boot.reset()
        await Boot.init(root)
      },
      fn: () => Skill.available(),
    })

    expect(available.some((skill) => skill.name === "mathflow")).toBe(true)
    expect(available.some((skill) => skill.name === "shadow-mathflow")).toBe(false)
  })
})
