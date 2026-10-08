import type { Activity } from "@hub/core/nyx"
import type { Mood } from "@hub/core/mood"
import type { Theme } from "../theme"

export interface NyxView {
  activity: Activity
  mood: Mood
}

const MOON_SHADOW: Record<Mood, number> = {
  happy: 0,
  content: 0.35,
  sad: 0.75,
  grumpy: 0.75,
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: NyxView | null,
  time: number,
  theme: Theme,
  glow: number,
): void {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)
  if (view === null) return

  const radius = Math.min(width, height) * 0.12
  const x = width / 2
  const y = height / 2 + bob(view.activity, time) * radius
  const brightness = view.activity === "sleeping" ? 0.45 : 1

  drawOrb(ctx, x, y, radius * pulse(view.activity, time), brightness, glow, theme)
  drawMoon(ctx, x, y - radius * 3.2, radius * 0.45, view.mood, theme)
  if (view.activity === "sleeping") drawZs(ctx, x + radius, y - radius, radius, time, theme)
}

function bob(activity: Activity, time: number): number {
  if (activity === "sleeping") return Math.sin(time / 1600) * 0.04
  return Math.sin(time / 900) * 0.12
}

function pulse(activity: Activity, time: number): number {
  if (activity === "eating" || activity === "playing") {
    return 1 + Math.sin(time / 120) * 0.06
  }
  return 1
}

function drawOrb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  brightness: number,
  glow: number,
  theme: Theme,
): void {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.5)
  halo.addColorStop(0, `rgb(${theme.glow} / ${Math.min(1, 0.9 * brightness * glow)})`)
  halo.addColorStop(0.35, `rgb(${theme.glow} / ${Math.min(1, 0.35 * brightness * glow)})`)
  halo.addColorStop(1, `rgb(${theme.glow} / 0)`)
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = `rgb(${theme.core} / ${brightness})`
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function drawMoon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  mood: Mood,
  theme: Theme,
): void {
  ctx.fillStyle = mood === "grumpy" ? theme.moonGrumpy : theme.moon
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()

  const shadow = MOON_SHADOW[mood]
  if (shadow === 0) return

  ctx.fillStyle = theme.background
  ctx.beginPath()
  ctx.arc(x + 2 * radius * (1 - shadow), y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function drawZs(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
  theme: Theme,
): void {
  ctx.fillStyle = theme.text
  for (let i = 0; i < 3; i++) {
    const t = (time / 2500 + i / 3) % 1
    ctx.globalAlpha = 1 - t
    ctx.font = `${size * (0.3 + t * 0.3)}px system-ui`
    ctx.fillText("z", x + t * size * 0.6, y - t * size * 1.5)
  }
  ctx.globalAlpha = 1
}