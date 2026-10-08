import { useCallback, useEffect, useRef, useState } from "react"
import type { ClientMessage, ServerMessage } from "@hub/shared/messages"
import { connect } from "./connection"
import type { Connection, ConnectionStatus } from "./connection"

const HUB_URL = `ws://${location.hostname}:8080/ws`

export type NyxMessage = Extract<ServerMessage, { type: "nyx" }>

export function useHub(room: string) {
  const [nyx, setNyx] = useState<NyxMessage | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>({ state: "connecting" })
  const connection = useRef<Connection | null>(null)

  useEffect(() => {
    const opened = connect({
      url: HUB_URL,
      hello: { type: "hello", room, topics: ["nyx"] },
      onMessage: (message) => {
        if (message.type === "nyx") setNyx(message)
        else console.warn(`hub error: ${message.reason}`)
      },
      onStatus: setStatus,
    })
    connection.current = opened

    return () => {
      opened.close()
      connection.current = null
    }
  }, [room])

  const send = useCallback((message: ClientMessage) => {
    connection.current?.send(message)
  }, [])

  return { nyx, status, send }
}
