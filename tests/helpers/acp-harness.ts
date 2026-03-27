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

type PromptRunResult = ReturnType<ReturnType<typeof createACPHarness>["runPrompt"]> extends Promise<infer TResult>
  ? TResult
  : never

type MatrixResultLike = {
  model: string | null
  scenario: string
  completion: PromptRunResult["completion"]
  aggregatedText: string
  notifications: unknown[]
  errors: unknown[]
}

type MatrixRun = {
  harness: ReturnType<typeof createACPHarness>
  started: Awaited<ReturnType<ReturnType<typeof createACPHarness>["start"]>>
  result: PromptRunResult
  report: {
    summary: string
    result: PromptRunResult
  }
}

type PromptRunCapture = {
  sessionId: string
  requestId: string | number | null
  notifications: unknown[]
  errors: unknown[]
  resolveFinalResponse: (response: JsonRpcResponse | null) => void
  finalResponse: Promise<JsonRpcResponse | null>
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

function summarizeText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized
}

function formatMatrixResult(result: MatrixResultLike) {
  const segments = [
    `model=${result.model ?? "unknown"}`,
    `scenario=${result.scenario}`,
    `state=${result.completion.state}`,
  ]

  if (result.completion.classification) {
    segments.push(`classification=${result.completion.classification}`)
  }

  const textPreview = summarizeText(result.aggregatedText)
  if (textPreview) {
    segments.push(`text=${JSON.stringify(textPreview)}`)
  }

  if (result.errors.length > 0) {
    segments.push(`errors=${result.errors.length}`)
  }

  if (result.notifications.length > 0) {
    segments.push(`notifications=${result.notifications.length}`)
  }

  return {
    summary: segments.join(" | "),
    result,
  }
}

export function createACPHarness(options?: {
  server?: ACPServer
  dispatch?: (request: DispatchRequest) => Promise<DispatchResult>
}) {
  const server = options?.server ?? new ACPServer()
  let promptRunCounter = 0
  const dispatch = (request: DispatchRequest) => {
    if (options?.dispatch) return options.dispatch(request)
    return server.dispatch(request)
  }
  const collectors = new Set<{
    notifications: unknown[]
    errors: unknown[]
  }>()
  const promptRunsByRequestId = new Map<string | number | null, PromptRunCapture>()
  const promptRunsBySessionId = new Map<string, Set<PromptRunCapture>>()

  const createCollector = () => {
    const collector = {
      notifications: [] as unknown[],
      errors: [] as unknown[],
    }

    collectors.add(collector)
    return collector
  }

  const releaseCollector = (collector: {
    notifications: unknown[]
    errors: unknown[]
  }) => {
    collectors.delete(collector)
  }

  const registerPromptRun = (run: PromptRunCapture) => {
    promptRunsByRequestId.set(run.requestId, run)

    const sessionRuns = promptRunsBySessionId.get(run.sessionId) ?? new Set<PromptRunCapture>()
    sessionRuns.add(run)
    promptRunsBySessionId.set(run.sessionId, sessionRuns)
  }

  const releasePromptRun = (run: PromptRunCapture) => {
    promptRunsByRequestId.delete(run.requestId)

    const sessionRuns = promptRunsBySessionId.get(run.sessionId)
    if (!sessionRuns) return

    sessionRuns.delete(run)
    if (sessionRuns.size === 0) {
      promptRunsBySessionId.delete(run.sessionId)
    }
  }

  server.onNotification = (message) => {
    for (const collector of collectors) {
      collector.notifications.push(message)

      if (isJsonRpcResponse(message) && message.error) {
        collector.errors.push(message)
      }
    }

    if (isSessionUpdateMessage(message)) {
      const sessionId = getSessionId(message)
      if (!sessionId) return

      const runs = promptRunsBySessionId.get(sessionId)
      if (!runs) return

      for (const run of runs) {
        run.notifications.push(message)
      }
      return
    }

    if (isJsonRpcResponse(message)) {
      const run = promptRunsByRequestId.get(message.id ?? null)
      if (!run) return

      run.notifications.push(message)

      if (message.error) {
        run.errors.push(message)
      }

      run.resolveFinalResponse(message)
    }
  }

  return {
    formatMatrixResult,

    async start({ cwd }: { cwd: string }) {
      const startedAt = Date.now()
      const collector = createCollector()

      try {
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
          notifications: [...collector.notifications],
          errors: [...collector.errors],
          timeline: {
            startedAt,
          },
          model: null,
          scenario: "session-bootstrap",
        }
      } finally {
        releaseCollector(collector)
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
      const collector = createCollector()

      try {
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
          notifications: [...collector.notifications],
          errors: [...collector.errors],
          timeline: {
            startedAt,
          },
          scenario: "session-bootstrap-load",
        }
      } finally {
        releaseCollector(collector)
      }
    },

    async runPrompt({
      sessionId,
      prompt,
      _meta,
      scenario,
      timeoutMs,
    }: {
      sessionId: string
      prompt: string | unknown[]
      _meta: Record<string, unknown>
      scenario?: string
      timeoutMs: number
    }) {
      const startedAt = Date.now()
      promptRunCounter += 1
      const requestId = `prompt-${startedAt}-${promptRunCounter}`
      let resolveFinalResponse!: (response: JsonRpcResponse | null) => void
      const promptRun: PromptRunCapture = {
        sessionId,
        requestId,
        notifications: [],
        errors: [],
        finalResponse: new Promise<JsonRpcResponse | null>((resolve) => {
          resolveFinalResponse = resolve
        }),
        resolveFinalResponse: (response) => resolveFinalResponse(response),
      }
      registerPromptRun(promptRun)

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
        const deadline = setTimeout(() => {
          timedOut = true
          fireAndForgetCancel(dispatch, requestId, sessionId)
          promptRun.resolveFinalResponse(null)
        }, timeoutMs)

        const immediateFinalResponse = isJsonRpcResponse(promptImmediateResult) && promptImmediateResult.error
          ? promptImmediateResult
          : null

        const finalResponse = immediateFinalResponse ?? await promptRun.finalResponse
        clearTimeout(deadline)

        const normalized = collectPromptResult({
          notifications: [...promptRun.notifications],
          errors: [...promptRun.errors],
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
          scenario: scenario ?? "prompt-lifecycle",
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
        releasePromptRun(promptRun)
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
      const errors = notifications.filter(
        (message) => isJsonRpcResponse(message) && !!message.error,
      )

      const normalized = collectPromptResult({
        notifications,
        errors,
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

createACPHarness.createIsolatedMatrixRun = async function createIsolatedMatrixRun({
  cwd,
  model,
  scenario,
  prompt,
  timeoutMs,
  promptMeta,
  createHarness = () => createACPHarness(),
}: {
  cwd: string
  model: string
  scenario: string
  prompt: string | unknown[]
  timeoutMs: number
  promptMeta: {
    baseUrl: string
    apiKey: string
  }
  createHarness?: () => ReturnType<typeof createACPHarness>
}): Promise<MatrixRun> {
  const harness = createHarness()
  const started = await harness.start({ cwd })
  const result = await harness.runPrompt({
    sessionId: started.sessionResult.sessionId,
    prompt,
    _meta: {
      model,
      ...promptMeta,
    },
    scenario,
    timeoutMs,
  })

  return {
    harness,
    started,
    result,
    report: harness.formatMatrixResult(result),
  }
}

export namespace createACPHarness {
  export let createIsolatedMatrixRun: (params: {
    cwd: string
    model: string
    scenario: string
    prompt: string | unknown[]
    timeoutMs: number
    promptMeta: {
      baseUrl: string
      apiKey: string
    }
    createHarness?: () => ReturnType<typeof createACPHarness>
  }) => Promise<MatrixRun>
}
