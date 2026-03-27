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
      const result = createPromptResult({ messageID, sessionID })
      await Session.updateMessage(result.info)
      return result
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
    const metadataCalls: Array<{ title?: string; metadata?: Record<string, unknown> }> = []

    const result = await tool.execute(
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
        metadata(input) {
          metadataCalls.push(input as { title?: string; metadata?: Record<string, unknown> })
        },
        ask: options.ask ?? (async () => {}),
      },
    )

    return {
      result,
      metadataCalls,
    }
  }

  async function createInterruptedChildSession(parentID: SessionID, subagentType: string) {
    const child = await Session.create({
      parentID,
      title: `interrupted (@${subagentType} subagent)`,
    })
    const userMessageID = MessageID.ascending()

    await Session.updateMessage({
      id: userMessageID,
      sessionID: child.id,
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

    await Session.updatePart({
      id: PartID.ascending(),
      sessionID: child.id,
      messageID: userMessageID,
      type: "subtask",
      agent: subagentType,
      description: "interrupted task",
      prompt: "run task",
      model: {
        providerID: ProviderID.openai,
        modelID: MODEL_ID,
      },
    })

    return child.id
  }

  function parseTaskID(output: string) {
    const line = output.split("\n").find((item) => item.startsWith("task_id: "))
    if (!line) throw new Error("Missing task_id in output")
    return line.slice("task_id: ".length).split(" ")[0]
  }

  test("fresh subagent invocation creates a child session with compatibility-visible task_id", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const { result, metadataCalls } = await executeTask({}, parent)
      const childID = SessionID.make(parseTaskID(result.output))
      const child = await Session.get(childID)

      expect(child.parentID).toBe(parent.sessionID)
      expect(result.output).toContain(`task_id: ${childID}`)
      expect(result.output).not.toContain("<task_result>")
      expect(result.output).not.toContain("</task_result>")
      expect(result.output).toContain("subagent ok")
      expect(parseTaskID(result.output)).toBe(childID)
      expect(result.metadata.sessionId).toBe(childID)
      expect(result.metadata.model).toEqual({
        modelID: MODEL_ID,
        providerID: ProviderID.openai,
      })
      expect(result.metadata.resultText).toBe("subagent ok")
      expect(result.metadata.resultEmpty).toBe(false)
      expect(result.metadata.taskID).toBe(childID)
      expect(result.metadata.resumable).toEqual({
        task_id: childID,
      })
      expect(metadataCalls).toEqual([
        {
          title: "test task",
          metadata: {
            sessionId: childID,
            model: {
              modelID: MODEL_ID,
              providerID: ProviderID.openai,
            },
            resultText: "subagent ok",
            resultEmpty: false,
            taskID: childID,
            resumable: {
              task_id: childID,
            },
          },
        },
      ])
      expect(result.metadata.resumable.task_id).toBe(parseTaskID(result.output))
      expect(promptCallCount).toBe(1)
    })
  })

  test("valid task_id resumes the same child session and returns that same child session ID", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const { result: first } = await executeTask({}, parent)
      const childID = parseTaskID(first.output)
      const childSessionsBeforeResume = await Session.children(parent.sessionID)

      const { result: resumed } = await executeTask({ task_id: childID }, parent)
      const childSessionsAfterResume = await Session.children(parent.sessionID)

      expect(parseTaskID(resumed.output)).toBe(childID)
      expect((await Session.get(SessionID.make(childID))).parentID).toBe(parent.sessionID)
      expect(childSessionsBeforeResume.map((child) => child.id)).toEqual([SessionID.make(childID)])
      expect(childSessionsAfterResume.map((child) => child.id)).toEqual([SessionID.make(childID)])
      expect(promptCallCount).toBe(2)
    })
  })

  test("task_id remains parseable when task output is otherwise empty", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      ;(SessionPrompt as any).prompt = async ({ messageID, sessionID }: { messageID: MessageID; sessionID: SessionID }) => {
        promptCallCount += 1
        const result = {
          ...createPromptResult({ messageID, sessionID }),
          parts: [],
        }
        await Session.updateMessage(result.info)
        return result
      }

      const { result } = await executeTask({}, parent)
      const childID = parseTaskID(result.output)

      expect(childID).toBe(result.metadata.taskID)
      expect(result.metadata.resumable).toEqual({ task_id: childID })
      expect(result.output).toBe(`task_id: ${childID} (for resuming to continue this task if needed)\n\n`)
      expect(promptCallCount).toBe(1)
    })
  })

  test("resuming with the same task_id and subagent_type allows a different description", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const { result: first } = await executeTask({ description: "first label", subagent_type: "general" }, parent)
      const childID = parseTaskID(first.output)
      const promptCallsBeforeResume = promptCallCount

      const { result: resumed } = await executeTask(
        {
          description: "updated label",
          subagent_type: "general",
          task_id: childID,
        },
        parent,
      )

      expect(parseTaskID(resumed.output)).toBe(childID)
      expect((await Session.get(SessionID.make(childID))).parentID).toBe(parent.sessionID)
      expect(promptCallCount).toBe(promptCallsBeforeResume + 1)
    })
  })

  test("resuming with a different subagent_type is rejected", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const { result: first } = await executeTask({ subagent_type: "general" }, parent)
      const childID = parseTaskID(first.output)
      const promptCallsBeforeInvalidResume = promptCallCount

      await expect(executeTask({ task_id: childID, subagent_type: "explore" }, parent)).rejects.toThrow(
        `Task session agent does not match requested subagent_type: ${childID}`,
      )
      expect(promptCallCount).toBe(promptCallsBeforeInvalidResume)
    })
  })

  test("resuming an interrupted child session with a different subagent_type is rejected", async () => {
    await withinInstance(async () => {
      const parent = await createExecutionContext()
      const childID = await createInterruptedChildSession(parent.sessionID, "general")
      const promptCallsBeforeInvalidResume = promptCallCount

      await expect(executeTask({ task_id: childID, subagent_type: "explore" }, parent)).rejects.toThrow(
        `Task session agent does not match requested subagent_type: ${childID}`,
      )
      expect(promptCallCount).toBe(promptCallsBeforeInvalidResume)
    })
  })

  test("task_id from a different parent session is rejected", async () => {
    await withinInstance(async () => {
      const parentA = await createExecutionContext()
      const parentB = await createExecutionContext()
      const { result: first } = await executeTask({}, parentA)
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
