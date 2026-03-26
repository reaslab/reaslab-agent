// Stub: ConfigMarkdown utilities for reaslab-agent
// Original is in opencode config module, not ported

export namespace ConfigMarkdown {
  /** Extract @file references from a template string */
  export function files(template: string): RegExpMatchArray[] {
    const regex = /(?<![`\w])@([\w.\/~-]+[\w\/])/g
    const matches: RegExpMatchArray[] = []
    let match: RegExpMatchArray | null
    while ((match = regex.exec(template)) !== null) {
      matches.push(match)
    }
    return matches
  }

  /** Extract !`shell` commands from a template string */
  export function shell(template: string): RegExpMatchArray[] {
    const regex = /!`([^`]+)`/g
    const matches: RegExpMatchArray[] = []
    let match: RegExpMatchArray | null
    while ((match = regex.exec(template)) !== null) {
      matches.push(match)
    }
    return matches
  }

  /** Parse a markdown file with frontmatter (stub) */
  export async function parse(filepath: string): Promise<{ data: Record<string, any>; content: string }> {
    const fs = await import("fs/promises")
    const raw = await fs.readFile(filepath, "utf-8")
    // Simple frontmatter parser
    const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
    const match = raw.match(fmRegex)
    if (!match) {
      return { data: {}, content: raw }
    }
    const yaml = match[1]
    const content = match[2]
    // Basic YAML-like key: value parsing
    const data: Record<string, any> = {}
    for (const line of yaml.split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (kv) {
        data[kv[1]] = kv[2].replace(/^["']|["']$/g, "")
      }
    }
    return { data, content }
  }
}
