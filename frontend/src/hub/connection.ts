import type { ClientMessage, ServerMessage } from "@hub/shared/messages"

export type ConnectionStatus =
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "disconnected", retryInMs: number }

export function statusText(status: ConnectionStatus): string {
  if (status.state === "disconnected") {
    return `disconnected, retrying in ${status.retryInMs / 1000}s`
  }
  return status.state
}

interface ConnectOptions {
  url: string
  hello: ClientMessage
  onMessage: (message: ServerMessage) => void
  onStatus: (status: ConnectionStatus) => void
}

export interface Connection {
  send: (message: ClientMessage) => void
  close: () => void
}

export function connect(options: ConnectOptions): Connection {
  let socket: WebSocket | null = null
  let retryMs = 500
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  function open() {
    options.onStatus({ state: "connecting" })
    const ws = new WebSocket(options.url)
    socket = ws

    ws.addEventListener("open", () => {
      if (closed) return
      retryMs = 500
      options.onStatus({ state: "connected" })
      ws.send(JSON.stringify(options.hello))
    })

    ws.addEventListener("message", (event) => {
      if (closed) return
      options.onMessage(JSON.parse(event.data as string) as ServerMessage)
    })

    ws.addEventListener("close", () => {
      if (closed) return
      options.onStatus({ state: "disconnected", retryInMs: retryMs })
      retryTimer = setTimeout(open, retryMs)
      retryMs = Math.min(retryMs * 2, 10_000)
    })
  }

  open()

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
    close() {
      closed = true
      clearTimeout(retryTimer)
      socket?.close()
    },
  }
}
