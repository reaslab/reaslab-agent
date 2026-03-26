import fs from "fs/promises"
import os from "os"
import path from "path"
import { Boot } from "../../src/boot"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"

export async function withRuntime<T>(directory: string, fn: () => Promise<T>) {
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

export async function createTempRuntime(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const discoveredRoot = path.join(root, "discovered")
  const sessionRoot = path.join(root, "session")
  const hiddenRoot = path.join(root, "hidden")

  await fs.mkdir(discoveredRoot, { recursive: true })
  await fs.mkdir(sessionRoot, { recursive: true })
  await fs.mkdir(hiddenRoot, { recursive: true })

  return {
    root,
    discoveredRoot,
    sessionRoot,
    hiddenRoot,
  }
}

export async function writeSkill(root: string, name: string, description: string, body = "Skill body") {
  const file = path.join(root, name, "SKILL.md")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    ["---", `name: ${name}`, `description: ${description}`, "---", "", body, ""].join("\n"),
  )
  return file
}
