import type { ServerMessage } from "@hub/shared/messages"
import type { Action } from "@hub/core/nyx"
import { ACTIONS } from "@hub/core/nyx"
import { connect } from "./connection"
import { drawFrame } from "./draw"
import type { NyxView } from "./draw"

const HUB_URL = `ws://${location.hostname}:8080/ws`
const ROOM = new URLSearchParams(location.search).get("room") ?? "dev"

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing #${id} in index.html`)
  return found
}

const connectionLine = element("connection")
const status = element("status")

function canvasElement(id: string): HTMLCanvasElement {
  const found = element(id)
  if (!(found instanceof HTMLCanvasElement)) throw new Error(`#${id} must be a canvas`)
  return found
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d")
  if (!context) throw new Error("this browser has no 2d canvas")
  return context
}

const canvas = canvasElement("world")
const ctx = context2d(canvas)

let view: NyxView | null = null

function resize() {
  const ratio = window.devicePixelRatio || 1
  canvas.width = canvas.clientWidth * ratio
  canvas.height = canvas.clientHeight * ratio
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
}

window.addEventListener("resize", resize)
resize()

function frame(time: number) {
  drawFrame(ctx, canvas.clientWidth, canvas.clientHeight, view, time)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)

function show(message: ServerMessage) {
  if (message.type === "error") {
    status.textContent = `error: ${message.reason}`
    return
  }
  view = { activity: message.state.activity, mood: message.mood }

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