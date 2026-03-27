import { ACPServer } from "../../src/acp/server"

type JsonRpcSuccess<T> = {
  result: T
}

type InitializeResult = {
  protocolVersion: string
}

type AuthenticateResult = {
  authenticated: boolean
}

type SessionResult = {
  sessionId: string
}

type JsonRpcResponse = {
  jsonrpc: "2.0"
  id?: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

type SessionUpdateNotification = {
  method?: string
  params?: {
    update?: {
      sessionUpdate?: string
      content?: {
        text?: string
      }
      toolCallId?: string
    }
  }
}

type PromptCompletionState = "completed" | "errored" | "timed_out"

type PromptCompletionClassification =
  | "protocol_mismatch"
  | "runtime_failure"
  | "model_variance"

function isJsonRpcResponse(message: unknown): message is JsonRpcResponse {
  return !!message && typeof message === "object" && "jsonrpc" in message && ("result" in message || "error" in message)
}

function isSessionUpdateNotification(message: unknown): message is SessionUpdateNotification {
  return !!message && typeof message === "object" && "method" in message
}

function classifyCompletion(params: {
  timedOut: boolean
  finalResponse: JsonRpcResponse | null
  errors: unknown[]
}): {
  state: PromptCompletionState
  classification: PromptCompletionClassification
} {
  if (params.timedOut) {
    return {
      state: "timed_out",
      classification: "runtime_failure",
    }
  }

  if (!params.finalResponse) {
    return {
      state: "errored",
      classification: "protocol_mismatch",
    }
  }

  if (params.finalResponse.error) {
    return {
      state: "errored",
      classification: "runtime_failure",
    }
  }

  const stopReason =
    params.finalResponse.result &&
    typeof params.finalResponse.result === "object" &&
    "stopReason" in params.finalResponse.result
      ? params.finalResponse.result.stopReason
      : undefined

  if (stopReason === "error") {
    return {
      state: "errored",
      classification: "runtime_failure",
    }
  }

  if (params.errors.length > 0) {
    return {
      state: "errored",
      classification: "model_variance",
    }
  }

  return {
    state: "completed",
    classification: "model_variance",
  }
}

export function createACPHarness() {
  const server = new ACPServer()
  let currentNotifications: unknown[] = []
  let currentErrors: unknown[] = []

  server.onNotification = (message) => {
    currentNotifications.push(message)

    if (isJsonRpcResponse(message) && message.error) {
      currentErrors.push(message)
    }
  }

  return {
    async start({ cwd }: { cwd: string }) {
      const startedAt = Date.now()
      currentNotifications = []
      currentErrors = []

      const initialize = await server.dispatch({
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: {},
      }) as JsonRpcSuccess<InitializeResult>

      const authenticate = await server.dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "authenticate",
        params: {},
      }) as JsonRpcSuccess<AuthenticateResult>

      const session = await server.dispatch({
        jsonrpc: "2.0",
        id: "3",
        method: "session/new",
        params: { cwd },
      }) as JsonRpcSuccess<SessionResult>

      return {
        initializeResult: initialize.result,
        authenticateResult: authenticate.result,
        sessionResult: session.result,
        notifications: currentNotifications,
        errors: currentErrors,
        timeline: {
          startedAt,
        },
        model: null,
        scenario: "session-bootstrap",
      }
    },

    async runPrompt({
      sessionId,
      prompt,
      _meta,
      timeoutMs,
    }: {
      sessionId: string
      prompt: string | unknown[]
      _meta: Record<string, unknown>
      timeoutMs: number
    }) {
      const startedAt = Date.now()
      currentNotifications = []
      currentErrors = []

      const requestId = `prompt-${startedAt}`

      const promptImmediateResult = await server.dispatch({
        jsonrpc: "2.0",
        id: requestId,
        method: "session/prompt",
        params: {
          sessionId,
          prompt,
          _meta,
        },
      }) as JsonRpcSuccess<null>

      let timedOut = false
      let cancelResult: JsonRpcSuccess<{ cancelled: boolean }> | null = null

      const finalResponse = await new Promise<JsonRpcResponse | null>((resolve) => {
        const deadline = setTimeout(async () => {
          timedOut = true
          cancelResult = await server.dispatch({
            jsonrpc: "2.0",
            id: `${requestId}-cancel`,
            method: "session/cancel",
            params: {
              sessionId,
            },
          }) as JsonRpcSuccess<{ cancelled: boolean }>
          resolve(null)
        }, timeoutMs)

        const poll = () => {
          const response = currentNotifications.find((message) => {
            if (!isJsonRpcResponse(message)) return false
            return message.id === requestId
          }) as JsonRpcResponse | undefined

          if (response) {
            clearTimeout(deadline)
            resolve(response)
            return
          }

          setTimeout(poll, 10)
        }

        poll()
      })

      const notifications = [...currentNotifications]
      const errors = [...currentErrors]
      const sessionUpdates = notifications.filter(isSessionUpdateNotification)
      const textChunks = sessionUpdates.filter(
        (message) => message.params?.update?.sessionUpdate === "agent_message_chunk",
      )
      const thoughtChunks = sessionUpdates.filter(
        (message) => message.params?.update?.sessionUpdate === "agent_thought_chunk",
      )
      const toolCalls = sessionUpdates.filter(
        (message) => message.params?.update?.sessionUpdate === "tool_call",
      )
      const toolCallUpdates = sessionUpdates.filter(
        (message) => message.params?.update?.sessionUpdate === "tool_call_update",
      )
      const planUpdates = sessionUpdates.filter(
        (message) => message.params?.update?.sessionUpdate === "plan",
      )

      const aggregatedText = textChunks
        .map((message) => message.params?.update?.content?.text ?? "")
        .join("")
      const aggregatedThoughts = thoughtChunks
        .map((message) => message.params?.update?.content?.text ?? "")
        .join("")
      const completion = classifyCompletion({
        timedOut,
        finalResponse,
        errors,
      })

      return {
        promptImmediateResult: promptImmediateResult.result,
        notifications,
        errors,
        aggregatedText,
        aggregatedThoughts,
        toolCalls,
        toolCallUpdates,
        planUpdates,
        finalResponse,
        model: typeof _meta.model === "string" ? _meta.model : null,
        scenario: "prompt-lifecycle",
        timeline: {
          startedAt,
          completedAt: Date.now(),
          timeoutMs,
        },
        completion: {
          ...completion,
          cancelResult: cancelResult?.result ?? null,
        },
      }
    },
  }
}
