import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Boot } from "../../src/boot"
import { Config } from "../../src/config/config"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, SessionID } from "../../src/session/schema"
import { ToolRegistry } from "../../src/tool/registry"

const workspaceID = WorkspaceID.make("wrk_runtime_skill_tools")
const sessionID = SessionID.make("ses_runtime_skill_tools")
const messageID = MessageID.make("msg_runtime_skill_tools")
const repositoryMathflowPath = path.resolve(import.meta.dir, "../../skills/mathflow/SKILL.md")
const repositoryProblemAnalysisPath = path.resolve(import.meta.dir, "../../skills/problem-analysis/SKILL.md")
const repositoryResearchPlanningPath = path.resolve(import.meta.dir, "../../skills/research-planning/SKILL.md")
const repositorySelfAuditLoopPath = path.resolve(import.meta.dir, "../../skills/self-audit-loop/SKILL.md")
const repositoryNumericalExperimentationPath = path.resolve(import.meta.dir, "../../skills/numerical-experimentation/SKILL.md")
const repositoryResultValidationPath = path.resolve(import.meta.dir, "../../skills/result-validation/SKILL.md")
const repositoryReportWritingPath = path.resolve(import.meta.dir, "../../skills/report-writing/SKILL.md")

type RuntimeToolID = "skill-finder" | "load-skill" | "unload-skill"

function skillFilePath(root: string, name: string) {
  return path.join(root, name, "SKILL.md")
}

async function writeSkillFile(root: string, name: string, description: string, body: string) {
  const file = skillFilePath(root, name)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "---",
      "",
      body,
      "",
    ].join("\n"),
  )
  return file
}

async function writeInvalidSkillFile(root: string, name: string) {
  const file = skillFilePath(root, name)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, ["---", `name: ${name}`, "---", "", "Missing description", ""].join("\n"))
  return file
}

async function withRuntime<T>(directory: string, fn: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: async () => {
      Config.reset()
      Boot.reset()
      await Boot.init(directory)
    },
    fn,
  })
}

async function executeRuntimeTool(input: {
  directory: string
  toolID: RuntimeToolID
  args: Record<string, unknown>
  ask?: (request: Record<string, unknown>) => Promise<void>
}) {
  return withRuntime(input.directory, async () => {
    const tools = await ToolRegistry.tools({
      providerID: ProviderID.make("reaslab"),
      modelID: ModelID.make("default"),
    })
    const tool = tools.find((item) => item.id === input.toolID)
    expect(tool, `expected ${input.toolID} to be registered`).toBeDefined()

    const permissionRequests: Record<string, unknown>[] = []
    const metadataEvents: Array<{ title?: string; metadata?: Record<string, unknown> }> = []

    const result = await tool!.execute(input.args, {
      sessionID,
      messageID,
      agent: "build",
      abort: AbortSignal.timeout(30000),
      messages: [],
      metadata(event) {
        metadataEvents.push(event as { title?: string; metadata?: Record<string, unknown> })
      },
      async ask(request) {
        const next = request as Record<string, unknown>
        permissionRequests.push(next)
        await input.ask?.(next)
      },
    })

    return {
      result,
      permissionRequests,
      metadataEvents,
    }
  })
}

async function findSkill(directory: string, args: Record<string, unknown>) {
  return executeRuntimeTool({
    directory,
    toolID: "skill-finder",
    args,
  })
}

async function loadSkill(directory: string, args: Record<string, unknown>, ask?: (request: Record<string, unknown>) => Promise<void>) {
  return executeRuntimeTool({
    directory,
    toolID: "load-skill",
    args,
    ask,
  })
}

async function unloadSkill(directory: string, args: Record<string, unknown>) {
  return executeRuntimeTool({
    directory,
    toolID: "unload-skill",
    args,
  })
}

function expectNotFound(result: any) {
  expect(result.metadata?.status).toBe("not_found")
}

function expectFound(result: any, name: string) {
  expect(result.metadata?.status).toBe("ok")
  expect(result.output).toContain(name)
}

describe("runtime skill tools", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    Config.reset()
    Boot.reset()
  })

  afterEach(async () => {
    await Instance.disposeAll()
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test("skill-finder returns a discovered skill from the runtime root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    await writeSkillFile(root, "visible-skill", "visible runtime skill", "Visible body")

    const call = await findSkill(root, {
      scope: "workspace",
      workspaceID,
    })

    expect(call.result.output).toContain("visible-skill")
    expect(call.result.metadata?.status).toBe("ok")
  })

  test("skill-finder returns a workspace-local discovered skill from skills/", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    await writeSkillFile(path.join(root, "skills"), "mathflow", "workspace-local runtime skill", "Mathflow body")

    const call = await findSkill(root, {
      query: "mathflow",
      scope: "workspace",
      workspaceID,
    })

    expectFound(call.result, "mathflow")
  })

  test("skill-finder discovers repository analysis and modeling stage skills", async () => {
    const workspace = path.resolve(import.meta.dir, "../..")

    const analysisCall = await findSkill(workspace, {
      query: "problem-analysis",
      scope: "workspace",
      workspaceID,
    })

    expectFound(analysisCall.result, "problem-analysis")

    const modelingCall = await findSkill(workspace, {
      query: "mathematical-modeling",
      scope: "workspace",
      workspaceID,
    })

    expectFound(modelingCall.result, "mathematical-modeling")
  })

  test("skill-finder discovers repository derivation and planning stage skills", async () => {
    const workspace = path.resolve(import.meta.dir, "../..")

    const derivationCall = await findSkill(workspace, {
      query: "derivation-and-proof-checking",
      scope: "workspace",
      workspaceID,
    })

    expectFound(derivationCall.result, "derivation-and-proof-checking")

    const planningCall = await findSkill(workspace, {
      query: "research-planning",
      scope: "workspace",
      workspaceID,
    })

    expectFound(planningCall.result, "research-planning")
  })

  test("skill-finder discovers the repository self audit stage skill", async () => {
    const workspace = path.resolve(import.meta.dir, "../..")

    const selfAuditCall = await findSkill(workspace, {
      query: "self-audit-loop",
      scope: "workspace",
      workspaceID,
    })

    expectFound(selfAuditCall.result, "self-audit-loop")
  })

  test("skill-finder discovers repository experimentation and validation stage skills", async () => {
    const workspace = path.resolve(import.meta.dir, "../..")

    const experimentationCall = await findSkill(workspace, {
      query: "numerical-experimentation",
      scope: "workspace",
      workspaceID,
    })

    expectFound(experimentationCall.result, "numerical-experimentation")

    const validationCall = await findSkill(workspace, {
      query: "result-validation",
      scope: "workspace",
      workspaceID,
    })

    expectFound(validationCall.result, "result-validation")
  })

  test("skill-finder discovers the repository reporting stage skill", async () => {
    const workspace = path.resolve(import.meta.dir, "../..")

    const reportWritingCall = await findSkill(workspace, {
      query: "report-writing",
      scope: "workspace",
      workspaceID,
    })

    expectFound(reportWritingCall.result, "report-writing")
  })

  test("load-skill loads problem-analysis from a local path and makes it available in session scope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)

    const loaded = await loadSkill(root, {
      localPath: repositoryProblemAnalysisPath,
      workspaceID,
      sessionID,
    })

    expect(loaded.result.metadata?.status).toBe("ok")
    expect(loaded.result.metadata?.scope).toBe("session")
    expect(loaded.result.metadata?.name).toBe("problem-analysis")
    expect(loaded.result.output).not.toContain("<skill_content name=\"problem-analysis\">")
    expect(loaded.result.output).not.toContain("## Hard rules")

    const visible = await findSkill(root, {
      query: "problem-analysis",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectFound(visible.result, "problem-analysis")
  })

  test("load-skill registers mathflow without auto-expanding dependent stage skills", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)

    const loaded = await loadSkill(root, {
      localPath: repositoryMathflowPath,
      workspaceID,
      sessionID,
    })

    expect(loaded.result.metadata?.status).toBe("ok")
    expect(loaded.result.metadata?.scope).toBe("session")
    expect(loaded.result.metadata?.name).toBe("mathflow")
    expect(loaded.result.output).not.toContain("<skill_content name=\"mathflow\">")
    expect(loaded.result.output).not.toContain("problem-analysis")
    expect(loaded.result.output).not.toContain("research-planning")

    const mathflowVisible = await findSkill(root, {
      query: "mathflow",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectFound(mathflowVisible.result, "mathflow")

    const problemAnalysisVisible = await findSkill(root, {
      query: "problem-analysis",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectNotFound(problemAnalysisVisible.result)

    const researchPlanningVisible = await findSkill(root, {
      query: "research-planning",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectNotFound(researchPlanningVisible.result)
  })

  test("load-skill loads research-planning from a local path and makes it available in session scope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)

    const loaded = await loadSkill(root, {
      localPath: repositoryResearchPlanningPath,
      workspaceID,
      sessionID,
    })

    expect(loaded.result.metadata?.status).toBe("ok")
    expect(loaded.result.metadata?.scope).toBe("session")
    expect(loaded.result.metadata?.name).toBe("research-planning")

    const visible = await findSkill(root, {
      query: "research-planning",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectFound(visible.result, "research-planning")
  })

  test("load-skill loads self-audit-loop from a local path and makes it available in session scope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)

    const loaded = await loadSkill(root, {
      localPath: repositorySelfAuditLoopPath,
      workspaceID,
      sessionID,
    })

    expect(loaded.result.metadata?.status).toBe("ok")
    expect(loaded.result.metadata?.scope).toBe("session")
    expect(loaded.result.metadata?.name).toBe("self-audit-loop")

    const visible = await findSkill(root, {
      query: "self-audit-loop",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectFound(visible.result, "self-audit-loop")
  })

  test("load-skill loads result-validation from a local path and makes it available in session scope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)

    const loaded = await loadSkill(root, {
      localPath: repositoryResultValidationPath,
      workspaceID,
      sessionID,
    })

    expect(loaded.result.metadata?.status).toBe("ok")
    expect(loaded.result.metadata?.scope).toBe("session")
    expect(loaded.result.metadata?.name).toBe("result-validation")

    const visible = await findSkill(root, {
      query: "result-validation",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectFound(visible.result, "result-validation")
  })

  test("load-skill loads report-writing from a local path and makes it available in session scope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)

    const loaded = await loadSkill(root, {
      localPath: repositoryReportWritingPath,
      workspaceID,
      sessionID,
    })

    expect(loaded.result.metadata?.status).toBe("ok")
    expect(loaded.result.metadata?.scope).toBe("session")
    expect(loaded.result.metadata?.name).toBe("report-writing")

    const visible = await findSkill(root, {
      query: "report-writing",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectFound(visible.result, "report-writing")
  })

  test("skill-finder can include a session-hidden skill", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    await writeSkillFile(root, "hidden-skill", "hidden runtime skill", "Hidden body")

    await unloadSkill(root, {
      name: "hidden-skill",
      scope: "session",
      workspaceID,
      sessionID,
    })

    const call = await findSkill(root, {
      query: "hidden-skill",
      includeHidden: true,
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectFound(call.result, "hidden-skill")
    expect(call.result.metadata?.includeHidden).toBe(true)

    const hiddenByDefault = await findSkill(root, {
      query: "hidden-skill",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectNotFound(hiddenByDefault.result)
  })

  test("skill-finder includeHidden still respects denied-path filtering", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    const localPath = await writeSkillFile(root, "denied-hidden-skill", "hidden denied skill", "Hidden denied body")

    await expect(
      loadSkill(
        root,
        {
          localPath,
          workspaceID,
          sessionID,
        },
        async () => {
          throw new Error("User denied local skill path access")
        },
      ),
    ).rejects.toThrow(/user denied local skill path access|permission denied|denied/i)

    const call = await findSkill(root, {
      query: "denied-hidden-skill",
      includeHidden: true,
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectNotFound(call.result)
  })

  test("load-skill uses session scope by default for a local skill", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    const localPath = await writeSkillFile(root, "session-default", "session default skill", "Session body")

    const call = await loadSkill(root, {
      localPath,
      workspaceID,
      sessionID,
    })

    expect(call.result.metadata?.scope).toBe("session")
    expect(call.result.metadata?.status).toBe("ok")
  })

  test("unload-skill hides a discovered skill for one session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    await writeSkillFile(root, "shared-discovered", "shared discovered skill", "Shared body")

    await findSkill(root, {
      query: "shared-discovered",
      scope: "workspace",
      workspaceID,
    })

    await unloadSkill(root, {
      name: "shared-discovered",
      scope: "session",
      workspaceID,
      sessionID,
    })

    const hiddenResult = await findSkill(root, {
      query: "shared-discovered",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectNotFound(hiddenResult.result)

    const workspaceResult = await findSkill(root, {
      query: "shared-discovered",
      scope: "workspace",
      workspaceID,
    })

    expectFound(workspaceResult.result, "shared-discovered")
  })

  test("unload-skill requests mutation permission before hiding", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    await writeSkillFile(root, "permission-hidden", "permission hidden skill", "Permission body")

    await expect(
      executeRuntimeTool({
        directory: root,
        toolID: "unload-skill",
        args: {
          name: "permission-hidden",
          scope: "session",
          workspaceID,
          sessionID,
        },
        async ask() {
          throw new Error("User denied skill hide")
        },
      }),
    ).rejects.toThrow(/user denied skill hide|permission denied|denied/i)

    const stillVisible = await findSkill(root, {
      query: "permission-hidden",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectFound(stillVisible.result, "permission-hidden")
  })

  test("load-skill blocks a workspace-scoped mutation when permission is denied", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    const localPath = await writeSkillFile(root, "workspace-mutation", "workspace runtime skill", "Workspace body")

    const deniedLoad = loadSkill(
      root,
      {
        localPath,
        scope: "workspace",
        workspaceID,
      },
      async () => {
        throw new Error("User denied workspace skill mutation")
      },
    )

    await expect(deniedLoad).rejects.toThrow(/user denied workspace skill mutation|permission denied|denied/i)

    const afterDenied = await findSkill(root, {
      query: "workspace-mutation",
      scope: "workspace",
      workspaceID,
    })

    expectNotFound(afterDenied.result)
  })

  test("load-skill rejects invalid local skill frontmatter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    const localPath = await writeInvalidSkillFile(root, "invalid-frontmatter")

    await expect(
      loadSkill(root, {
        localPath,
        workspaceID,
        sessionID,
      }),
    ).rejects.toThrow(/description|frontmatter|invalid/i)
  })

  test("skill-finder reports an unknown discovered skill query", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)

    const call = await findSkill(root, {
      query: "does-not-exist",
      scope: "workspace",
      workspaceID,
    })

    expectNotFound(call.result)
  })

  test("load-skill fails for an inaccessible local path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    const localPath = path.join(root, "missing", "SKILL.md")

    await expect(
      loadSkill(root, {
        localPath,
        workspaceID,
        sessionID,
      }),
    ).rejects.toThrow(/not found|inaccessible|missing/i)
  })

  test("load-skill stops when local-path permission is denied", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    const localPath = await writeSkillFile(root, "denied-local-path", "denied local path skill", "Denied body")

    await expect(
      loadSkill(
        root,
        {
          localPath,
          workspaceID,
          sessionID,
        },
        async () => {
          throw new Error("User denied local skill path access")
        },
      ),
    ).rejects.toThrow(/user denied local skill path access|permission denied|denied/i)

    const afterDenied = await findSkill(root, {
      query: "denied-local-path",
      scope: "session",
      workspaceID,
      sessionID,
    })

    expectNotFound(afterDenied.result)
  })

  test("load-skill reports a command conflict for a colliding skill name", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    const localPath = await writeSkillFile(root, "init", "conflicts with builtin init command", "Conflict body")

    const call = await loadSkill(root, {
      localPath,
      workspaceID,
      sessionID,
    })

    expect(call.result.metadata?.status).toBe("command_conflict")
  })

  test("load-skill reports a skill conflict for a colliding discovered skill name", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runtime-tools-"))
    tempDirs.push(root)
    await writeSkillFile(root, "shared-skill", "discovered shared skill", "Discovered body")

    const localRoot = path.join(root, "local")
    const localPath = await writeSkillFile(localRoot, "shared-skill", "local shared skill", "Local body")

    const call = await loadSkill(root, {
      localPath,
      workspaceID,
      sessionID,
    })

    expect(call.result.metadata?.status).toBe("skill_conflict")
  })
})
