import { beforeEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { BashTool } from "../../src/tool/bash"

describe("BashTool collaborative safety", () => {
  let askCalls: any[]

  beforeEach(() => {
    askCalls = []
  })

  async function execute(command: string) {
    return await Instance.provide({
      directory: "D:/Workspace/reaslab-agent",
      fn: async () => {
        const tool = await BashTool.init()
        return tool.execute(
          {
            command,
            description: "test bash command",
            workdir: "D:/Workspace/reaslab-agent",
            timeout: 1000,
          },
          {
            sessionID: "ses_test" as any,
            messageID: "msg_test" as any,
            agent: "default",
            abort: new AbortController().signal,
            messages: [],
            extra: { collaborativeMode: true },
            metadata() {},
            async ask(input) {
              askCalls.push(input)
            },
          },
        )
      },
    })
  }

  test("rejects shell redirection into workspace files in collaborative mode", async () => {
    await expect(execute('cat > "README.md"')).rejects.toThrow(
      "bash cannot modify workspace files in collaborative mode",
    )
  })

  test("rejects indirect python file writes in collaborative mode", async () => {
    await expect(
      execute('python -c "from pathlib import Path; Path(\"README.md\").write_text(\"hi\")"'),
    ).rejects.toThrow("bash cannot modify workspace files in collaborative mode")
  })

  test("allows non-mutating git status in collaborative mode", async () => {
    const result = await execute("git status --short")
    expect(result.output).toBeString()
    expect(askCalls.some((call) => call.permission === "bash")).toBe(true)
  })
})
