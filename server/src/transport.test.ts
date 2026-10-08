import { describe, it, expect, afterEach } from "vitest"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { WebSocket } from "ws"
import type { ServerMessage } from "@hub/shared/messages"
import { MINUTE } from "@hub/core/config"
import { startNyx } from "./nyxResident"
import type { Store } from "./nyxResident"
import { startHub } from "./app"

const T0 = 1000 * MINUTE
const noopStore: Store = { load: async () => null, save: async () => {} }

let hub: ReturnType<typeof startHub> | null = null

afterEach(() => {
  hub?.close()
  hub = null
})

async function startTestHub() {
  const nyx = await startNyx(noopStore, () => T0)
  hub = startHub(nyx, 0)
  await once(hub.server, "listening")
  return (hub.server.address() as AddressInfo).port
}

function connect(port: number) {
  const socket = new WebSocket(`ws://localhost:${port}/ws`)
  const inbox: ServerMessage[] = []
  const waiting: Array<(message: ServerMessage) => void> = []

  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage
    const waiter = waiting.shift()
    if (waiter) waiter(message)
    else inbox.push(message)
  })

  return {
    opened: new Promise<void>((resolve) => socket.once("open", () => resolve())),
    send: (message: unknown) => socket.send(JSON.stringify(message)),
    sendRaw: (text: string) => socket.send(text),
    next: () =>
      new Promise<ServerMessage>((resolve) => {
        const queued = inbox.shift()
        if (queued) resolve(queued)
        else waiting.push(resolve)
      }),
  }
}

describe("transport", () => {
  it("answers /health", async () => {
    const port = await startTestHub()
    const response = await fetch(`http://localhost:${port}/health`)
    expect(await response.json()).toEqual({ ok: true })
  })

  it("answers hello with a snapshot of Nyx", async () => {
    const client = connect(await startTestHub())
    await client.opened
    client.send({ type: "hello", room: "test", topics: ["nyx"] })

    const message = await client.next()
    expect(message.type).toBe("nyx")
  })

  it("broadcasts an action's result to every subscriber", async () => {
    const port = await startTestHub()
    const a = connect(port)
    const b = connect(port)
    await Promise.all([a.opened, b.opened])

    a.send({ type: "hello", room: "a", topics: ["nyx"] })
    b.send({ type: "hello", room: "b", topics: ["nyx"] })
    await a.next()
    await b.next()

    a.send({ type: "act", action: "feed" })
    const seenByB = await b.next()
    expect(seenByB.type === "nyx" && seenByB.state.activity).toBe("eating")
  })

  it("answers invalid messages with an error and stays open", async () => {
    const client = connect(await startTestHub())
    await client.opened

    client.sendRaw("not json")
    expect((await client.next()).type).toBe("error")

    client.send({ type: "hello", room: "test", topics: ["nyx"] })
    expect((await client.next()).type).toBe("nyx")
  })

  it("refuses actions before hello", async () => {
    const client = connect(await startTestHub())
    await client.opened
    client.send({ type: "act", action: "feed" })
    expect((await client.next()).type).toBe("error")
  })
})