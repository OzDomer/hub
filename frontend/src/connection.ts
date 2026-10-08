import type { ClientMessage, ServerMessage } from "@hub/shared/messages"

interface ConnectOptions {
  url: string
  hello: ClientMessage
  onMessage: (message: ServerMessage) => void
  onStatus: (status: string) => void
}

export function connect(options: ConnectOptions) {
  let socket: WebSocket | null = null
  let retryMs = 500

  function open() {
    options.onStatus("connecting...")
    const ws = new WebSocket(options.url)
    socket = ws

    ws.addEventListener("open", () => {
      retryMs = 500
      options.onStatus("connected")
      ws.send(JSON.stringify(options.hello))
    })

    ws.addEventListener("message", (event) => {
      options.onMessage(JSON.parse(event.data as string) as ServerMessage)
    })

    ws.addEventListener("close", () => {
      options.onStatus(`disconnected, retrying in ${retryMs / 1000}s`)
      setTimeout(open, retryMs)
      retryMs = Math.min(retryMs * 2, 10_000)
    })
  }

  open()

  return {
    send(message: ClientMessage) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
  }
}