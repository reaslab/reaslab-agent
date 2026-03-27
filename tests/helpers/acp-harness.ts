import { ACPServer } from "../../src/acp/server"

type DispatchRequest = Parameters<ACPServer["dispatch"]>[0]
type DispatchResult = Awaited<ReturnType<ACPServer["dispatch"]>>

type JsonRpcSuccess<T> = {
  result: T
}

type InitializeResult = {
  protocolVersion: string
  capabilities: {
    streaming: boolean
    tools: boolean
    skills: boolean
  }
  serverInfo: {
    name: string
    version: string
  }
}

type AuthenticateResult = {
  authenticated: boolean
}

type SessionResult = {
  sessionId: string
  workspace: string
  plan: {
    entries: Array<{
      content: string
      status: "pending" | "in_progress" | "completed"
      priority: "high" | "medium" | "low"
    }>
  }
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

type SessionUpdateMessage = {
  method?: string
  params?: {
    update?: {
      sessionUpdate?: string
      entries?: Array<{
        content: string
        status: "pending" | "in_progress" | "completed"
        priority: "high" | "medium" | "low"
      }>
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

type PromptCompletion = {
  state: PromptCompletionState
  classification: PromptCompletionClassification | null
}

type PromptRunCapture = {
  sessionId: string
  requestId: string | number | null
  notifications: unknown[]
  errors: unknown[]
}

function isJsonRpcResponse(message: unknown): message is JsonRpcResponse {
  return !!message && typeof message === "object" && "jsonrpc" in message && ("result" in message || "error" in message)
}

function isSessionUpdateMessage(message: unknown): message is SessionUpdateMessage {
  return (
    !!message &&
    typeof message === "object" &&
    "method" in message &&
    message.method === "session/update"
  )
}

function getSessionId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined
  if ("params" in message && message.params && typeof message.params === "object" && "sessionId" in message.params) {
    return typeof message.params.sessionId === "string" ? message.params.sessionId : undefined
  }
  return undefined
}

function matchesPromptRun(message: unknown, run: PromptRunCapture): boolean {
  if (isSessionUpdateMessage(message)) {
    return getSessionId(message) === run.sessionId
  }

  if (isJsonRpcResponse(message)) {
    return message.id === run.requestId
  }

  return false
}

function classifyCompletion(params: {
  timedOut: boolean
  finalResponse: JsonRpcResponse | null
  errors: unknown[]
}): PromptCompletion {
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

  if (stopReason === "end_turn") {
    return {
      state: "completed",
      classification: null,
    }
  }

  if (params.errors.length > 0) {
    return {
      state: "errored",
      classification: "runtime_failure",
    }
  }

  return {
    state: "errored",
    classification: "protocol_mismatch",
  }
}

function collectPromptResult(params: {
  notifications: unknown[]
  errors: unknown[]
  timedOut: boolean
  finalResponse: JsonRpcResponse | null
}) {
  const sessionUpdates = params.notifications.filter(isSessionUpdateMessage)
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

  return {
    notifications: params.notifications,
    errors: params.errors,
    aggregatedText: textChunks
      .map((message) => message.params?.update?.content?.text ?? "")
      .join(""),
    aggregatedThoughts: thoughtChunks
      .map((message) => message.params?.update?.content?.text ?? "")
      .join(""),
    toolCalls,
    toolCallUpdates,
    planUpdates,
    finalResponse: params.finalResponse,
    completion: classifyCompletion({
      timedOut: params.timedOut,
      finalResponse: params.finalResponse,
      errors: params.errors,
    }),
  }
}

function fireAndForgetCancel(
  dispatch: (request: DispatchRequest) => Promise<DispatchResult>,
  requestId: string,
  sessionId: string,
) {
  void Promise.resolve()
    .then(() => dispatch({
      jsonrpc: "2.0",
      id: `${requestId}-cancel`,
      method: "session/cancel",
      params: {
        sessionId,
      },
    }) as Promise<JsonRpcSuccess<{ cancelled: boolean }>>)
    .catch(() => null)
}

export function createACPHarness(options?: {
  server?: ACPServer
  dispatch?: (request: DispatchRequest) => Promise<DispatchResult>
}) {
  const server = options?.server ?? new ACPServer()
  const dispatch = (request: DispatchRequest) => {
    if (options?.dispatch) return options.dispatch(request)
    return server.dispatch(request)
  }
  let currentNotifications: unknown[] = []
  let currentErrors: unknown[] = []
  let activePromptRun: PromptRunCapture | null = null

  server.onNotification = (message) => {
    currentNotifications.push(message)

    if (isJsonRpcResponse(message) && message.error) {
      currentErrors.push(message)
    }

    if (activePromptRun && matchesPromptRun(message, activePromptRun)) {
      activePromptRun.notifications.push(message)

      if (isJsonRpcResponse(message) && message.error) {
        activePromptRun.errors.push(message)
      }
    }
  }

  return {
    async start({ cwd }: { cwd: string }) {
      const startedAt = Date.now()
      currentNotifications = []
      currentErrors = []

      const initialize = await dispatch({
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: {},
      }) as JsonRpcSuccess<InitializeResult>

      const authenticate = await dispatch({
        jsonrpc: "2.0",
        id: "2",
        method: "authenticate",
        params: {},
      }) as JsonRpcSuccess<AuthenticateResult>

      const session = await dispatch({
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

    async loadSession({
      sessionId,
      cwd,
    }: {
      sessionId: string
      cwd: string
    }) {
      const startedAt = Date.now()
      currentNotifications = []
      currentErrors = []

      const session = await dispatch({
        jsonrpc: "2.0",
        id: "load-1",
        method: "session/load",
        params: {
          sessionId,
          cwd,
        },
      }) as JsonRpcSuccess<SessionResult>

      return {
        sessionResult: session.result,
        notifications: currentNotifications,
        errors: currentErrors,
        timeline: {
          startedAt,
        },
        scenario: "session-bootstrap-load",
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
      activePromptRun = {
        sessionId,
        requestId,
        notifications: [],
        errors: [],
      }

      try {
        const promptImmediateResult = await dispatch({
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
        let cancelResult: { cancelled: boolean } | null = null
        const immediateFinalResponse = isJsonRpcResponse(promptImmediateResult) && promptImmediateResult.error
          ? promptImmediateResult
          : null

        const finalResponse = immediateFinalResponse ?? await new Promise<JsonRpcResponse | null>((resolve) => {
          let settled = false
          let pollTimer: ReturnType<typeof setTimeout> | undefined

          const findResponse = () => activePromptRun?.notifications.find((message) => {
            if (!isJsonRpcResponse(message)) return false
            return message.id === requestId
          }) as JsonRpcResponse | undefined

          const finish = (value: JsonRpcResponse | null) => {
            if (settled) return
            settled = true
            clearTimeout(deadline)
            if (pollTimer) clearTimeout(pollTimer)
            resolve(value)
          }

          const deadline = setTimeout(() => {
            timedOut = true
            cancelResult = { cancelled: false }
            fireAndForgetCancel(dispatch, requestId, sessionId)
            finish(null)
          }, timeoutMs)

          const poll = () => {
            if (settled) return

            const response = findResponse()
            if (response) {
              finish(response)
              return
            }

            pollTimer = setTimeout(poll, 5)
          }

          poll()
        })

        const normalized = collectPromptResult({
          notifications: [...(activePromptRun?.notifications ?? [])],
          errors: [...(activePromptRun?.errors ?? [])],
          timedOut,
          finalResponse,
        })

        return {
          promptImmediateResult: promptImmediateResult.result,
          notifications: normalized.notifications,
          errors: normalized.errors,
          aggregatedText: normalized.aggregatedText,
          aggregatedThoughts: normalized.aggregatedThoughts,
          toolCalls: normalized.toolCalls,
          toolCallUpdates: normalized.toolCallUpdates,
          planUpdates: normalized.planUpdates,
          finalResponse: normalized.finalResponse,
          model: typeof _meta.model === "string" ? _meta.model : null,
          scenario: "prompt-lifecycle",
          timeline: {
            startedAt,
            completedAt: Date.now(),
            timeoutMs,
          },
          completion: {
            ...normalized.completion,
            cancelResult,
          },
        }
      } finally {
        activePromptRun = null
      }
    },

    async runDeterministicPrompt({
      sessionId,
      model,
      notifications,
      finalResponse,
    }: {
      sessionId: string
      model: string | null
      notifications: unknown[]
      finalResponse?: JsonRpcResponse | null
    }) {
      const startedAt = Date.now()
      currentNotifications = []
      currentErrors = []

      for (const notification of notifications) {
        server.onNotification?.(notification)
      }

      const normalized = collectPromptResult({
        notifications: [...currentNotifications],
        errors: [...currentErrors],
        timedOut: false,
        finalResponse: finalResponse ?? {
          jsonrpc: "2.0",
          id: `deterministic-${sessionId}`,
          result: { stopReason: "end_turn" },
        },
      })

      return {
        promptImmediateResult: null,
        notifications: normalized.notifications,
        errors: normalized.errors,
        aggregatedText: normalized.aggregatedText,
        aggregatedThoughts: normalized.aggregatedThoughts,
        toolCalls: normalized.toolCalls,
        toolCallUpdates: normalized.toolCallUpdates,
        planUpdates: normalized.planUpdates,
        finalResponse: normalized.finalResponse,
        model,
        scenario: "prompt-lifecycle",
        timeline: {
          startedAt,
          completedAt: Date.now(),
          timeoutMs: 0,
        },
        completion: {
          ...normalized.completion,
          cancelResult: null,
        },
      }
    },
  }
}
