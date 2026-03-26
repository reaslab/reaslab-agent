import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool } from "../../src/tool/task"

const WORKTREE_DIRECTORY = path.resolve(import.meta.dir, "..", "..")
const MODEL_ID = ModelID.make("gpt-5.4")

function createPromptResult(input: { messageID: MessageID; sessionID: SessionID }) {
  return {
    info: {
      id: input.messageID,
      sessionID: input.sessionID,
      role: "assistant" as const,
      time: {
        created: Date.now(),
        completed: Date.now(),
      },
      parentID: MessageID.make("msg_stub_parent"),
      modelID: MODEL_ID,
      providerID: ProviderID.openai,
      mode: "default",
      agent: "general",
      path: {
        cwd: WORKTREE_DIRECTORY,
        root: WORKTREE_DIRECTORY,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    },
    parts: [
      {
        id: PartID.ascending(),
        sessionID: input.sessionID,
        messageID: input.messageID,
        type: "text" as const,
        text: "subagent ok",
      },
    ],
  }
}

describe("TaskTool", () => {
  const originalPrompt = SessionPrompt.prompt
  const originalGet = Session.get
  let promptCallCount = 0

  beforeEach(async () => {
    promptCallCount = 0
    await fs.mkdir(path.join(WORKTREE_DIRECTORY, "migration"), { recursive: true })
    ;(SessionPrompt as any).prompt = async ({ messageID, sessionID }: { messageID: MessageID; sessionID: SessionID }) => {
      promptCallCount += 1
      return createPromptResult({ messageID, sessionID })
    }
  })

  afterEach(() => {
    ;(SessionPrompt as any).prompt = originalPrompt
    ;(Session as any).get = originalGet
  })

  async function withinInstance<T>(fn: () => Promise<T>) {
    return await Instance.provide({
      directory: WORKTREE_DIRECTORY,
      fn,
    })
  }

  async function seedAssistantMessage(sessionID: SessionID) {
    const userMessageID = MessageID.ascending()
    await Session.updateMessage({
      id: userMessageID,
      sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "build",
      model: {
        providerID: ProviderID.openai,
        modelID: MODEL_ID,
      },
    })

    const assistantMessageID = MessageID.ascending()
    await Session.updateMessage({
      id: assistantMessageID,
      sessionID,
      role: "assistant",
      time: {
        created: Date.now(),
        completed: Date.now(),
      },
      parentID: userMessageID,
      modelID: MODEL_ID,
      providerID: ProviderID.openai,
      mode: "default",
      agent: "build",
      path: {
        cwd: WORKTREE_DIRECTORY,
        root: WORKTREE_DIRECTORY,
      },
      cost: 0,
      tokens: {
        total: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    })

    return assistantMessageID
  }

  async function createExecutionContext() {
    const session = await Session.create({ title: "parent session" })
    const messageID = await seedAssistantMessage(session.id)
    return {
      sessionID: session.id,
      messageID,
    }
  }

  async function executeTask(
    input: {
      description?: string
      prompt?: string
      subagent_type?: string
      task_id?: string
    },
    options: {
      sessionID: SessionID
      messageID: MessageID
      bypassAgentCheck?: boolean
      ask?: () => Promise<void>
    },
  ) {
    const tool = await TaskTool.init()

    return await tool.execute(
      {
        description: input.description ?? "test task",
        prompt: input.prompt ?? "run task",
        subagent_type: input.subagent_type ?? "general",
        ...(input.task_id ? { task_id: input.task_id } : {}),
      },
      {
        sessionID: options.sessionID,
        messageID: options.messageID,
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        extra: options.bypassAgentCheck === undefined ? { bypassAgentCheck: true } : { bypassAgentCheck: options.bypassAgentCheck },
        metadata() {},
        ask: options.ask ?? (async () => {}),
      },
    )
  }

  function parseTaskID(output: string) {
    const line = output.split("\n").find((item) => item.startsWith("task_id: "))
    if (!line) throw new Error("Missing task_id in output")
    return line.slice("task_id: ".length).split(" ")[0]
  }

  test("fresh subagent invocation creates a child session", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const result = await executeTask({}, parent)
      const childID = SessionID.make(parseTaskID(result.output))
      const child = await Session.get(childID)

      expect(child.parentID).toBe(parent.sessionID)
      expect(result.output).toContain("subagent ok")
      expect(promptCallCount).toBe(1)
    })
  })

  test("valid task_id resumes the same child session and returns that same child session ID", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const first = await executeTask({}, parent)
      const childID = parseTaskID(first.output)
      const childSessionsBeforeResume = await Session.children(parent.sessionID)

      const resumed = await executeTask({ task_id: childID }, parent)
      const childSessionsAfterResume = await Session.children(parent.sessionID)

      expect(parseTaskID(resumed.output)).toBe(childID)
      expect((await Session.get(SessionID.make(childID))).parentID).toBe(parent.sessionID)
      expect(childSessionsBeforeResume.map((child) => child.id)).toEqual([SessionID.make(childID)])
      expect(childSessionsAfterResume.map((child) => child.id)).toEqual([SessionID.make(childID)])
      expect(promptCallCount).toBe(2)
    })
  })

  test("task_id from a different parent session is rejected", async () => {
    await withinInstance(async () => {
      const parentA = await createExecutionContext()
      const parentB = await createExecutionContext()
      const first = await executeTask({}, parentA)
      const childID = parseTaskID(first.output)
      const promptCallsBeforeInvalidResume = promptCallCount

      await expect(executeTask({ task_id: childID }, parentB)).rejects.toThrow(
        `Task session does not belong to current parent session: ${childID}`,
      )
      expect(promptCallCount).toBe(promptCallsBeforeInvalidResume)
    })
  })

  test("non-child session used as task_id is rejected", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const sibling = await Session.create({ title: "standalone session" })
      const promptCallsBeforeInvalidResume = promptCallCount

      await expect(executeTask({ task_id: sibling.id }, parent)).rejects.toThrow(
        `Task session is not a child session: ${sibling.id}`,
      )
      expect(promptCallCount).toBe(promptCallsBeforeInvalidResume)
    })
  })

  test("nonexistent task_id is rejected with explicit error", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const missingTaskID = "ses_missing_task_id"
      const promptCallsBeforeInvalidResume = promptCallCount

      await expect(executeTask({ task_id: missingTaskID }, parent)).rejects.toThrow(
        `Task session not found: ${missingTaskID}`,
      )
      expect(promptCallCount).toBe(promptCallsBeforeInvalidResume)
    })
  })

  test("unrelated Session.get failures are surfaced without not-found normalization", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const boom = new Error("storage offline")
      const promptCallsBeforeFailure = promptCallCount

      ;(Session as any).get = async () => {
        throw boom
      }

      await expect(executeTask({ task_id: "ses_any_existing_shape" }, parent)).rejects.toThrow("storage offline")
      expect(promptCallCount).toBe(promptCallsBeforeFailure)
    })
  })

  test("unknown subagent_type is rejected", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()

      await expect(executeTask({ subagent_type: "missing-agent" }, parent)).rejects.toThrow(
        "Unknown agent type: missing-agent is not a valid agent type",
      )
    })
  })

  test("unknown subagent_type is rejected before ask when bypass is disabled", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      let askCallCount = 0
      const promptCallsBeforeFailure = promptCallCount

      await expect(
        executeTask(
          { subagent_type: "missing-agent-before-ask" },
          {
            ...parent,
            bypassAgentCheck: false,
            ask: async () => {
              askCallCount += 1
            },
          },
        ),
      ).rejects.toThrow("Unknown agent type: missing-agent-before-ask is not a valid agent type")

      expect(askCallCount).toBe(0)
      expect(promptCallCount).toBe(promptCallsBeforeFailure)
    })
  })

  test("if both subagent_type and task_id are invalid, unknown-agent error wins", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()

      await expect(
        executeTask(
          {
            subagent_type: "missing-agent",
            task_id: "ses_missing_task_id",
          },
          parent,
        ),
      ).rejects.toThrow("Unknown agent type: missing-agent is not a valid agent type")
    })
  })
})
