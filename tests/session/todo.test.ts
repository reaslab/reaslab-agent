import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { rmSync } from "fs"
import { tmpdir } from "os"
import { randomUUID } from "crypto"
import { Boot } from "../../src/boot"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { Todo } from "../../src/session/todo"

describe("Todo.update", () => {
  const dataDir = path.join(tmpdir(), `reaslab-agent-todo-${randomUUID()}`)
  const workspace = path.join("D:\\Workspace\\reaslab-agent\\.worktrees\\todo-plan-acp-alignment")

  beforeEach(() => {
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

  test("publishes an updated event with the persisted ordered todo list", async () => {
    await Boot.init(workspace)

    await Instance.provide({
      directory: workspace,
      fn: async () => {
        const session = await Session.createNext({ directory: workspace })
        const todos = [
          {
            content: "Verify ACP bridge receives todo snapshots",
            status: "in_progress",
            priority: "high",
          },
          {
            content: "Keep event payload order stable",
            status: "pending",
            priority: "medium",
          },
        ]

        const eventPromise = new Promise<{ sessionID: typeof session.id; todos: typeof todos }>((resolve) => {
          const unsubscribe = Bus.subscribe(Todo.Event.Updated, (event) => {
            if (event.properties.sessionID !== session.id) return
            unsubscribe()
            resolve(event.properties)
          })
        })

        Todo.update({
          sessionID: session.id,
          todos,
        })

        const event = await eventPromise

        expect(Todo.get(session.id)).toEqual(todos)
        expect(event).toEqual({
          sessionID: session.id,
          todos,
        })
      },
    })
  })
})
