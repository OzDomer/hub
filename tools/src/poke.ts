import { WebSocket } from "ws"
import type { ServerMessage } from "@hub/shared/messages"

const url = process.env.HUB_URL ?? "ws://localhost:8080/ws"
const action = process.argv[2]

const socket = new WebSocket(url)

socket.on("open", () => {
  socket.send(JSON.stringify({ type: "hello", room: "poke", topics: ["nyx"] }))
  if (action) socket.send(JSON.stringify({ type: "act", action }))
})

socket.on("message", (data) => {
  const message = JSON.parse(data.toString()) as ServerMessage
  if (message.type === "error") {
    console.log(`error: ${message.reason}`)
    return
  }
  const { activity, stats } = message.state
  console.log(
    `${activity} ${message.mood}  hunger ${stats.hunger.toFixed(1)}` +
      `  energy ${stats.energy.toFixed(1)}  happy ${stats.happiness.toFixed(1)}`,
  )
})

socket.on("error", (error) => {
  console.log(`can't reach the hub at ${url}: ${error.message}`)
})