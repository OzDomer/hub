import type { Theme } from "../theme"
import type { DrawSwitches } from "./preview"
import { ALL_ON } from "./preview"
import type { ShownArt } from "./nyxArt"
import { cellRect, frameAt } from "./sprites"
import type { NyxManifest, Rect } from "./sprites"

// how tall she is, as a fraction of the canvas height, and where she stands
const FIGURE_HEIGHT = 0.45
const FLOOR = 0.92

// All her motion is in the frames (docs/nyxArtPipeline.md); this only places
// them. Frame index and next are crossfaded, so 12 fps reads as smooth.
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  manifest: NyxManifest,
  art: ShownArt<CanvasImageSource> | null,
  seconds: number,
  theme: Theme,
  switches: DrawSwitches = ALL_ON,
): void {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)
  if (art === null || !switches.nyx) return

  const clip = manifest.clips[art.clip]
  const frame = frameAt(clip.frames, manifest.fps, seconds)
  const blend = manifest.crossfade && switches.crossfade ? frame.blend : 0

  const scale = (height * FIGURE_HEIGHT) / manifest.frameHeight
  const figure = {
    x: (width - manifest.frameWidth * scale) / 2,
    y: height * FLOOR - manifest.frameHeight * scale,
    width: manifest.frameWidth * scale,
    height: manifest.frameHeight * scale,
  }

  // rendered illustrations, not pixel art (resizing the canvas resets this)
  ctx.imageSmoothingEnabled = true

  drawCrossfaded(ctx, art.body, manifest.columns, manifest.frameWidth, manifest.frameHeight, frame.index, frame.next, blend, figure)

  if (art.eyes !== null && switches.eyes) {
    const { sheet, image } = art.eyes
    const eyes = {
      x: figure.x + sheet.x * scale,
      y: figure.y + sheet.y * scale,
      width: sheet.width * scale,
      height: sheet.height * scale,
    }
    drawCrossfaded(ctx, image, manifest.columns, sheet.width, sheet.height, frame.index, frame.next, blend, eyes)
  }
}

function drawCrossfaded(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  columns: number,
  cellWidth: number,
  cellHeight: number,
  index: number,
  next: number,
  blend: number,
  to: Rect,
): void {
  drawCell(ctx, image, cellRect(index, columns, cellWidth, cellHeight), to)
  if (blend > 0) {
    ctx.globalAlpha = blend
    drawCell(ctx, image, cellRect(next, columns, cellWidth, cellHeight), to)
    ctx.globalAlpha = 1
  }
}

function drawCell(ctx: CanvasRenderingContext2D, image: CanvasImageSource, from: Rect, to: Rect): void {
  ctx.drawImage(image, from.x, from.y, from.width, from.height, to.x, to.y, to.width, to.height)
}
