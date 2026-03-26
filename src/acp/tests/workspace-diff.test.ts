import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("WorkspaceDiffer skip rules", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-diff-test-"))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test("skips node_modules directory", async () => {
    await fs.mkdir(path.join(tmpDir, "node_modules"))
    await fs.writeFile(path.join(tmpDir, "node_modules", "pkg.js"), "module.exports = {}")
    await fs.writeFile(path.join(tmpDir, "index.ts"), "export const x = 1")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    expect((differ as any).entries.has(path.join(tmpDir, "index.ts"))).toBe(true)
    expect((differ as any).entries.has(path.join(tmpDir, "node_modules", "pkg.js"))).toBe(false)
  })

  test("skips files larger than 512KB", async () => {
    const large = "x".repeat(513 * 1024)
    await fs.writeFile(path.join(tmpDir, "large.txt"), large)
    await fs.writeFile(path.join(tmpDir, "small.txt"), "hello")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    expect((differ as any).entries.has(path.join(tmpDir, "small.txt"))).toBe(true)
    expect((differ as any).entries.has(path.join(tmpDir, "large.txt"))).toBe(false)
  })

  test("skips binary files (null byte detection)", async () => {
    await fs.writeFile(path.join(tmpDir, "binary.bin"), Buffer.from([0x00, 0x01, 0x02]))
    await fs.writeFile(path.join(tmpDir, "text.txt"), "hello world")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    expect((differ as any).entries.has(path.join(tmpDir, "text.txt"))).toBe(true)
    expect((differ as any).entries.has(path.join(tmpDir, "binary.bin"))).toBe(false)
  })

  test("skips symlinks", async () => {
    await fs.writeFile(path.join(tmpDir, "real.txt"), "real content")
    try {
      await fs.symlink(path.join(tmpDir, "real.txt"), path.join(tmpDir, "link.txt"))
    } catch { return }
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    expect((differ as any).entries.has(path.join(tmpDir, "real.txt"))).toBe(true)
    expect((differ as any).entries.has(path.join(tmpDir, "link.txt"))).toBe(false)
  })

  test("skips .git directory", async () => {
    await fs.mkdir(path.join(tmpDir, ".git"))
    await fs.writeFile(path.join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main")
    await fs.writeFile(path.join(tmpDir, "tracked.ts"), "export const x = 1")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    expect((differ as any).entries.has(path.join(tmpDir, "tracked.ts"))).toBe(true)
    expect((differ as any).entries.has(path.join(tmpDir, ".git", "HEAD"))).toBe(false)
  })
})

describe("WorkspaceDiffer diff detection", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-diff-test-"))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test("detects modified file", async () => {
    const file = path.join(tmpDir, "hello.txt")
    await fs.writeFile(file, "original content")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    // Force mtime change
    await new Promise((r) => setTimeout(r, 10))
    await fs.writeFile(file, "modified content")
    const now = new Date()
    await fs.utimes(file, now, now)
    const diffs = await differ.computeDiffs(tmpDir)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].absolutePath).toBe(file)
    expect(diffs[0].oldText).toBe("original content")
    expect(diffs[0].newText).toBe("modified content")
  })

  test("detects new file (oldText is empty string)", async () => {
    await fs.writeFile(path.join(tmpDir, "existing.txt"), "exists")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    const newFile = path.join(tmpDir, "new.txt")
    await fs.writeFile(newFile, "brand new")
    const diffs = await differ.computeDiffs(tmpDir)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].absolutePath).toBe(newFile)
    expect(diffs[0].oldText).toBe("")
    expect(diffs[0].newText).toBe("brand new")
  })

  test("ignores unmodified files", async () => {
    await fs.writeFile(path.join(tmpDir, "same.txt"), "unchanged")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    const diffs = await differ.computeDiffs(tmpDir)
    expect(diffs).toHaveLength(0)
  })

  test("ignores deleted files (no error)", async () => {
    const file = path.join(tmpDir, "will-delete.txt")
    await fs.writeFile(file, "gone")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    await fs.rm(file)
    const diffs = await differ.computeDiffs(tmpDir)
    expect(diffs).toHaveLength(0)
  })

  test("returns [] if snapshot never called", async () => {
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    const diffs = await differ.computeDiffs(tmpDir)
    expect(diffs).toHaveLength(0)
  })

  test("returns diffs sorted by path", async () => {
    await fs.writeFile(path.join(tmpDir, "b.txt"), "before")
    await fs.writeFile(path.join(tmpDir, "a.txt"), "before")
    const { WorkspaceDiffer } = await import("../workspace-diff")
    const differ = new WorkspaceDiffer()
    await differ.snapshot(tmpDir)
    const now = new Date()
    await fs.writeFile(path.join(tmpDir, "b.txt"), "after")
    await fs.utimes(path.join(tmpDir, "b.txt"), now, now)
    await fs.writeFile(path.join(tmpDir, "a.txt"), "after")
    await fs.utimes(path.join(tmpDir, "a.txt"), now, now)
    const diffs = await differ.computeDiffs(tmpDir)
    expect(diffs).toHaveLength(2)
    expect(path.basename(diffs[0].absolutePath)).toBe("a.txt")
    expect(path.basename(diffs[1].absolutePath)).toBe("b.txt")
  })
})
