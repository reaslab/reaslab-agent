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

export function createACPHarness() {
  const server = new ACPServer()
  const notifications: unknown[] = []
  server.onNotification = (message) => {
    notifications.push(message)
  }

  return {
    async start({ cwd }: { cwd: string }) {
      const startedAt = Date.now()
      const errors: unknown[] = []

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
        notifications,
        errors,
        timeline: {
          startedAt,
        },
        model: null,
        scenario: "session-bootstrap",
      }
    },
  }
}
