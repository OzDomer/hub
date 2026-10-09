import type { Activity } from "@hub/core/nyx"
import type { Mood } from "@hub/core/mood"
import type { Theme } from "../theme"

export interface NyxView {
  activity: Activity
  mood: Mood
}

const FIGURE_HEIGHT = 0.45
const FLOOR = 0.92
const SLEEPING_ALPHA = 0.45
// beside her head, as fractions of the art (measured from nyxDay/nyxNight.png)
const ZS_AT = { x: 0.85, y: 0.22 }

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: NyxView | null,
  time: number,
  theme: Theme,
  image: HTMLImageElement | null,
): void {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)
  if (view === null || image === null) return

  const restingHeight = height * FIGURE_HEIGHT
  const figureHeight = restingHeight * bounce(view.activity, time)
  const figureWidth = figureHeight * (image.naturalWidth / image.naturalHeight)
  const x = (width - figureWidth) / 2
  const y = height * FLOOR - figureHeight - bob(view.activity, time) * restingHeight

  const sleeping = view.activity === "sleeping"
  if (sleeping) ctx.globalAlpha = SLEEPING_ALPHA
  ctx.drawImage(image, x, y, figureWidth, figureHeight)
  ctx.globalAlpha = 1

  if (sleeping) {
    drawZs(ctx, x + figureWidth * ZS_AT.x, y + figureHeight * ZS_AT.y, restingHeight * 0.3, time, theme)
  }
}

function bob(activity: Activity, time: number): number {
  if (activity === "sleeping") return Math.sin(time / 1600) * 0.01
  return Math.sin(time / 900) * 0.03
}

function bounce(activity: Activity, time: number): number {
  if (activity === "eating" || activity === "playing") {
    return 1 + Math.abs(Math.sin(time / 150)) * 0.04
  }
  return 1
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
