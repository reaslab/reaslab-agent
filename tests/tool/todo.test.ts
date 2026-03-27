import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "crypto"
import { rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { Boot } from "../../src/boot"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { TodoReadTool, TodoWriteTool } from "../../src/tool/todo"

describe("todo tools", () => {
  const workspace = path.resolve(import.meta.dir, "../..")
  let dataDir: string

  beforeEach(() => {
    dataDir = path.join(tmpdir(), `reaslab-agent-tool-todo-${randomUUID()}`)
    process.env.DATA_DIR = dataDir
    process.env.PROJECT_WORKSPACE = workspace
    Config.reset()
    Boot.reset()
  })

  afterEach(async () => {
    await Instance.disposeAll()
    Database.close()
    Config.reset()
    Boot.reset()
    delete process.env.DATA_DIR
    delete process.env.PROJECT_WORKSPACE
    rmSync(dataDir, { recursive: true, force: true })
  })

  test("todowrite persistence compatibility returns summary output and preserves full todos metadata", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const session = await Session.createNext({ directory: workspace })
        const todos = [
          {
            content: "Keep todowrite output stable",
            status: "in_progress",
            priority: "high",
          },
          {
            content: "Preserve metadata todos shape",
            status: "pending",
            priority: "medium",
          },
        ]

        const tool = await TodoWriteTool.init()
        const result = await tool.execute(
          { todos },
          {
            sessionID: session.id,
            messageID: "message-test" as any,
            agent: "default",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.output).toBe(
          [
            "2 todos",
            "Current focus: Keep todowrite output stable",
            "In progress: 1",
            "Pending: 1",
            "Completed: 0",
            "Cancelled: 0",
          ].join("\n"),
        )
        expect(result.metadata.todos).toEqual(todos)
        expect(result.metadata.summary).toEqual({
          total: 2,
          inProgress: 1,
          pending: 1,
          completed: 0,
          cancelled: 0,
        })
        expect(await TodoReadTool.init().then((tool) =>
          tool.execute(
            {},
            {
              sessionID: session.id,
              messageID: "message-test" as any,
              agent: "default",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              ask: async () => {},
            },
          ),
        )).toMatchObject({
          metadata: {
            todos,
            summary: {
              total: 2,
              inProgress: 1,
              pending: 1,
              completed: 0,
              cancelled: 0,
            },
          },
        })
      },
    })
  })

  test("todowrite persistence compatibility excludes cancelled todos from remaining count without current focus", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const session = await Session.createNext({ directory: workspace })
        const todos = [
          {
            content: "Leave no-focus branch covered",
            status: "pending",
            priority: "high",
          },
          {
            content: "Keep cancelled out of remaining count",
            status: "cancelled",
            priority: "low",
          },
        ]

        const tool = await TodoWriteTool.init()
        const result = await tool.execute(
          { todos },
          {
            sessionID: session.id,
            messageID: "message-test" as any,
            agent: "default",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.title).toBe("1 todo")
        expect(result.output).toBe(
          [
            "1 todo",
            "Pending: 1",
            "In progress: 0",
            "Completed: 0",
            "Cancelled: 1",
          ].join("\n"),
        )
        expect(result.metadata.todos).toEqual(todos)
        expect(result.metadata.summary).toEqual({
          total: 2,
          inProgress: 0,
          pending: 1,
          completed: 0,
          cancelled: 1,
        })
      },
    })
  })

  test("todoread persistence compatibility returns summary output and preserves full todos metadata", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const session = await Session.createNext({ directory: workspace })
        const todos = [
          {
            content: "Ship summary-first todo output",
            status: "in_progress",
            priority: "high",
          },
          {
            content: "Keep metadata todos unchanged",
            status: "cancelled",
            priority: "low",
          },
          {
            content: "Document count stability in tests",
            status: "pending",
            priority: "medium",
          },
        ]

        const writeTool = await TodoWriteTool.init()
        await writeTool.execute(
          { todos },
          {
            sessionID: session.id,
            messageID: "message-test" as any,
            agent: "default",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        const readTool = await TodoReadTool.init()
        const result = await readTool.execute(
          {},
          {
            sessionID: session.id,
            messageID: "message-test" as any,
            agent: "default",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(result.output).toBe(
          [
            "2 todos",
            "Current focus: Ship summary-first todo output",
            "In progress: 1",
            "Pending: 1",
            "Completed: 0",
            "Cancelled: 1",
          ].join("\n"),
        )
        expect(result.title).toBe("2 todos")
        expect(result.metadata.todos).toEqual(todos)
        expect(result.metadata.summary).toEqual({
          total: 3,
          inProgress: 1,
          pending: 1,
          completed: 0,
          cancelled: 1,
        })
      },
    })
  })
})
