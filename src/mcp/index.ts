import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { NamedError } from "@reaslab-agent/util/error"
import z from "zod/v4"
import { Instance } from "../project/instance"
import { Installation } from "../installation"
import { withTimeout } from "@/util/timeout"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000

  export const Resource = z
    .object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      client: z.string(),
    })
    .meta({ ref: "McpResource" })
  export type Resource = z.infer<typeof Resource>

  export const ToolsChanged = BusEvent.define(
    "mcp.tools.changed",
    z.object({
      server: z.string(),
    }),
  )

  export const BrowserOpenFailed = BusEvent.define(
    "mcp.browser.open.failed",
    z.object({
      mcpName: z.string(),
      url: z.string(),
    }),
  )

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  type MCPClient = Client

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({
          ref: "MCPStatusNeedsAuth",
        }),
      z
        .object({
          status: z.literal("needs_client_registration"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusNeedsClientRegistration",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  /** MCP server config provided via ACP at runtime */
  export interface McpServerConfig {
    url: string
    headers?: Record<string, string>
    timeout?: number
    enabled?: boolean
  }

  // Register notification handlers for MCP client
  function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info("tools list changed notification received", { server: serverName })
      Bus.publish(ToolsChanged, { server: serverName })
    })
  }

  // Convert MCP tool definition to AI SDK Tool type
  async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Promise<Tool> {
    const inputSchema = mcpTool.inputSchema

    // Clean schema to remove unsupported JSON Schema features
    const cleanSchema = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj

      const cleaned: any = Array.isArray(obj) ? [] : {}

      for (const [key, value] of Object.entries(obj)) {
        // Skip unsupported keywords that cause "Custom types cannot be represented" error
        if (['anyOf', 'oneOf', 'allOf', '$ref', 'definitions', '$defs'].includes(key)) {
          continue
        }

        cleaned[key] = typeof value === 'object' ? cleanSchema(value) : value
      }

      return cleaned
    }

    const schema: JSONSchema7 = {
      ...cleanSchema(inputSchema),
      type: "object",
      properties: cleanSchema(inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }

    try {
      return dynamicTool({
        description: mcpTool.description ?? "",
        inputSchema: jsonSchema(schema),
        execute: async (args: unknown) => {
          return client.callTool(
            {
              name: mcpTool.name,
              arguments: (args || {}) as Record<string, unknown>,
            },
            CallToolResultSchema,
            {
              resetTimeoutOnProgress: true,
              timeout,
            },
          )
        },
      })
    } catch (error) {
      log.error("Failed to convert MCP tool", {
        toolName: mcpTool.name,
        originalSchema: JSON.stringify(inputSchema, null, 2),
        cleanedSchema: JSON.stringify(schema, null, 2),
        error
      })
      throw error
    }
  }

  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]

  async function descendants(pid: number): Promise<number[]> {
    if (process.platform === "win32") return []
    const pids: number[] = []
    const queue = [pid]
    while (queue.length > 0) {
      const current = queue.shift()!
      const lines = await Process.lines(["pgrep", "-P", String(current)], { nothrow: true })
      for (const tok of lines) {
        const cpid = parseInt(tok, 10)
        if (!isNaN(cpid) && !pids.includes(cpid)) {
          pids.push(cpid)
          queue.push(cpid)
        }
      }
    }
    return pids
  }

  // In reaslab-agent, MCP servers are injected from ACP at runtime, not from config
  const _state: {
    clients: Record<string, MCPClient>
    status: Record<string, Status>
    configs: Record<string, McpServerConfig>
  } = {
    clients: {},
    status: {},
    configs: {},
  }

  const state = Instance.state(
    async () => _state,
    async (state) => {
      for (const client of Object.values(state.clients)) {
        const pid = (client.transport as any)?.pid
        if (typeof pid !== "number") continue
        for (const dpid of await descendants(pid)) {
          try {
            process.kill(dpid, "SIGTERM")
          } catch {}
        }
      }

      await Promise.all(
        Object.values(state.clients).map((client) =>
          client.close().catch((error: any) => {
            log.error("Failed to close MCP client", {
              error,
            })
          }),
        ),
      )
    },
  )

  // Helper function to fetch prompts for a specific client
  async function fetchPromptsForClient(clientName: string, client: Client) {
    const prompts = await client.listPrompts().catch((e: any) => {
      log.error("failed to get prompts", { clientName, error: e.message })
      return undefined
    })

    if (!prompts) {
      return
    }

    const commands: Record<string, PromptInfo & { client: string }> = {}

    for (const prompt of prompts.prompts) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedPromptName

      commands[key] = { ...prompt, client: clientName }
    }
    return commands
  }

  async function fetchResourcesForClient(clientName: string, client: Client) {
    const resources = await client.listResources().catch((e: any) => {
      log.error("failed to get resources", { clientName, error: e.message })
      return undefined
    })

    if (!resources) {
      return
    }

    const commands: Record<string, ResourceInfo & { client: string }> = {}

    for (const resource of resources.resources) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedResourceName = resource.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedResourceName

      commands[key] = { ...resource, client: clientName }
    }
    return commands
  }

  export async function add(name: string, mcp: McpServerConfig) {
    const s = await state()
    s.configs[name] = mcp
    const result = await create(name, mcp)
    if (!result) {
      const status = {
        status: "failed" as const,
        error: "unknown error",
      }
      s.status[name] = status
      return {
        status,
      }
    }
    if (!result.mcpClient) {
      s.status[name] = result.status
      return {
        status: s.status,
      }
    }
    // Close existing client if present to prevent memory leaks
    const existingClient = s.clients[name]
    if (existingClient) {
      await existingClient.close().catch((error: any) => {
        log.error("Failed to close existing MCP client", { name, error })
      })
    }
    s.clients[name] = result.mcpClient
    s.status[name] = result.status

    return {
      status: s.status,
    }
  }

  async function create(key: string, mcp: McpServerConfig) {
    if (mcp.enabled === false) {
      log.info("mcp server disabled", { key })
      return {
        mcpClient: undefined,
        status: { status: "disabled" as const },
      }
    }

    log.info("found", { key })
    let mcpClient: MCPClient | undefined
    let status: Status | undefined = undefined

    // reaslab-agent only supports remote HTTP MCP servers
    const transports: Array<{ name: string; transport: StreamableHTTPClientTransport | SSEClientTransport }> = [
      {
        name: "StreamableHTTP",
        transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
          requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
        }),
      },
      {
        name: "SSE",
        transport: new SSEClientTransport(new URL(mcp.url), {
          requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
        }),
      },
    ]

    let lastError: Error | undefined
    const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
    for (const { name, transport } of transports) {
      try {
        const client = new Client({
          name: "reaslab-agent",
          version: Installation.VERSION,
        })
        await withTimeout(client.connect(transport), connectTimeout)
        registerNotificationHandlers(client, key)
        mcpClient = client
        log.info("connected", { key, transport: name })
        status = { status: "connected" }
        break
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        log.debug("transport connection failed", {
          key,
          transport: name,
          url: mcp.url,
          error: lastError.message,
        })
        status = {
          status: "failed" as const,
          error: lastError.message,
        }
      }
    }

    if (!status) {
      status = {
        status: "failed" as const,
        error: "Unknown error",
      }
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        status,
      }
    }

    const result = await withTimeout(mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err: any) => {
      log.error("failed to get tools from client", { key, error: err })
      return undefined
    })
    if (!result) {
      await mcpClient.close().catch((error: any) => {
        log.error("Failed to close MCP client", {
          error,
        })
      })
      status = {
        status: "failed",
        error: "Failed to get tools",
      }
      return {
        mcpClient: undefined,
        status: {
          status: "failed" as const,
          error: "Failed to get tools",
        },
      }
    }

    log.info("create() successfully created client", { key, toolCount: result.tools.length })
    return {
      mcpClient,
      status,
    }
  }

  export async function status() {
    const s = await state()
    const result: Record<string, Status> = {}

    for (const [key] of Object.entries(s.configs)) {
      result[key] = s.status[key] ?? { status: "disabled" }
    }

    return result
  }

  export async function clients() {
    return state().then((state) => state.clients)
  }

  export async function connect(name: string) {
    const s = await state()
    const mcp = s.configs[name]
    if (!mcp) {
      log.error("MCP config not found", { name })
      return
    }

    const result = await create(name, { ...mcp, enabled: true })

    if (!result) {
      s.status[name] = {
        status: "failed",
        error: "Unknown error during connection",
      }
      return
    }

    s.status[name] = result.status
    if (result.mcpClient) {
      // Close existing client if present to prevent memory leaks
      const existingClient = s.clients[name]
      if (existingClient) {
        await existingClient.close().catch((error: any) => {
          log.error("Failed to close existing MCP client", { name, error })
        })
      }
      s.clients[name] = result.mcpClient
    }
  }

  export async function disconnect(name: string) {
    const s = await state()
    const client = s.clients[name]
    if (client) {
      await client.close().catch((error: any) => {
        log.error("Failed to close MCP client", { name, error })
      })
      delete s.clients[name]
    }
    s.status[name] = { status: "disabled" }
  }

  export async function tools() {
    const result: Record<string, Tool> = {}
    const s = await state()
    const clientsSnapshot = await clients()

    const connectedClients = Object.entries(clientsSnapshot).filter(
      ([clientName]) => s.status[clientName]?.status === "connected",
    )

    const toolsResults = await Promise.all(
      connectedClients.map(async ([clientName, client]) => {
        const toolsResult = await client.listTools().catch((e: any) => {
          log.error("failed to get tools", { clientName, error: e.message })
          const failedStatus = {
            status: "failed" as const,
            error: e instanceof Error ? e.message : String(e),
          }
          s.status[clientName] = failedStatus
          delete s.clients[clientName]
          return undefined
        })
        return { clientName, client, toolsResult }
      }),
    )

    for (const { clientName, client, toolsResult } of toolsResults) {
      if (!toolsResult) continue
      const mcpConfig = s.configs[clientName]
      const timeout = mcpConfig?.timeout
      for (const mcpTool of toolsResult.tools) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
        const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        result[sanitizedClientName + "_" + sanitizedToolName] = await convertMcpTool(mcpTool, client, timeout)
      }
    }
    return result
  }

  export async function prompts() {
    const s = await state()
    const clientsSnapshot = await clients()

    const prompts = Object.fromEntries<PromptInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchPromptsForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return prompts
  }

  export async function resources() {
    const s = await state()
    const clientsSnapshot = await clients()

    const result = Object.fromEntries<ResourceInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchResourcesForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return result
  }

  export async function getPrompt(clientName: string, name: string, args?: Record<string, string>) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName,
      })
      return undefined
    }

    const result = await client
      .getPrompt({
        name: name,
        arguments: args,
      })
      .catch((e: any) => {
        log.error("failed to get prompt from MCP server", {
          clientName,
          promptName: name,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  export async function readResource(clientName: string, resourceUri: string) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for resource", {
        clientName: clientName,
      })
      return undefined
    }

    const result = await client
      .readResource({
        uri: resourceUri,
      })
      .catch((e: any) => {
        log.error("failed to read resource from MCP server", {
          clientName: clientName,
          resourceUri: resourceUri,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  /**
   * Connect to MCP servers provided via ACP at runtime.
   * Called when the ACP protocol injects mcpServers config.
   */
  export async function connectFromACP(servers: Record<string, { url: string; headers?: Record<string, string> }>) {
    for (const [name, config] of Object.entries(servers)) {
      log.info("connecting MCP from ACP config", { name, url: config.url })
      await add(name, {
        url: config.url,
        headers: config.headers,
      })
    }
  }
}
