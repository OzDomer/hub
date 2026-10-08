import type { ServerMessage } from "@hub/shared/messages"
import type { Action } from "@hub/core/nyx"
import { ACTIONS } from "@hub/core/nyx"
import { connect } from "./connection"

const HUB_URL = `ws://${location.hostname}:8080/ws`
const ROOM = new URLSearchParams(location.search).get("room") ?? "dev"

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing #${id} in index.html`)
  return found
}

const connectionLine = element("connection")
const status = element("status")

function show(message: ServerMessage) {
  if (message.type === "error") {
    status.textContent = `error: ${message.reason}`
    return
  }
  const { activity, stats } = message.state
  status.textContent =
    `${activity} / ${message.mood}\n` +
    `hunger ${stats.hunger.toFixed(1)}\n` +
    `energy ${stats.energy.toFixed(1)}\n` +
    `happy  ${stats.happiness.toFixed(1)}`
}

function isAction(value: string | undefined): value is Action {
  return ACTIONS.some((action) => action === value)
}

const connection = connect({
  url: HUB_URL,
  hello: { type: "hello", room: ROOM, topics: ["nyx"] },
  onMessage: show,
  onStatus: (text) => {
    connectionLine.textContent = text
  },
})

element("actions").addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) return
  const action = target.dataset.action
  if (isAction(action)) connection.send({ type: "act", action })
})