import { WebSocketServer } from "ws"
import type { WebSocket } from "ws"
import type { Server } from "node:http"
import { parseClientMessage } from "@hub/shared/messages"
import type { ServerMessage } from "@hub/shared/messages"
import type { NyxState } from "@hub/core/nyx"
import { moodOf } from "@hub/core/mood"
import type { NyxResident } from "./nyxResident"

export interface Transport {
  close(): void
}

function snapshot(state: NyxState): ServerMessage {
  return { type: "nyx", state, mood: moodOf(state) }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

export function attachTransport(nyx: NyxResident, server: Server): Transport {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 })
  const subscribers = new Set<WebSocket>()

  const unsubscribe = nyx.onChange((state) => {
    for (const socket of subscribers) send(socket, snapshot(state))
  })

  wss.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        send(socket, { type: "error", reason: "binary messages are not supported" })
        return
      }

      const parsed = parseClientMessage(data.toString())
      if (!parsed.ok) {
        send(socket, { type: "error", reason: parsed.reason })
        return
      }

      const message = parsed.message
      switch (message.type) {
        case "hello":
          if (message.topics.includes("nyx")) {
            subscribers.add(socket)
            send(socket, snapshot(nyx.current()))
          }
          return

        case "act":
          if (!subscribers.has(socket)) {
            send(socket, { type: "error", reason: "say hello first" })
            return
          }
          nyx.act(message.action)
          return
      }
    })

    socket.on("close", () => subscribers.delete(socket))
  })

  return {
    close() {
      unsubscribe()
      for (const client of wss.clients) client.terminate()
      wss.close()
    },
  }
}