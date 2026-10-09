import { describe, expect, it } from "vitest"
import { drawFrame } from "./draw"
import type { ShownArt } from "./nyxArt"
import type { NyxManifest } from "./sprites"

// Records what drawFrame does; only the parts of the 2d context it uses
function fakeContext() {
  const calls: { image: string, alpha: number, from: number[], to: number[] }[] = []
  const ctx = {
    fillStyle: "",
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    fillRect() {},
    drawImage(image: { name: string }, ...args: number[]) {
      calls.push({ image: image.name, alpha: ctx.globalAlpha, from: args.slice(0, 4), to: args.slice(4) })
    },
  }
  return { ctx, calls, asCanvas: ctx as unknown as CanvasRenderingContext2D }
}

const manifest: NyxManifest = {
  frameWidth: 100,
  frameHeight: 200,
  fps: 10,
  columns: 4,
  crossfade: true,
  clips: {
    idle: {
      frames: 8,
      sheet: "idle.webp",
      eyes: { calm_day: { sheet: "eyes.webp", x: 40, y: 50, width: 20, height: 10 } },
    },
    sleep: { frames: 8, sheet: "sleep.webp", eyes: {} },
    eat: { frames: 8, sheet: "eat.webp", eyes: {} },
    play: { frames: 8, sheet: "play.webp", eyes: {} },
  },
}

const image = (name: string) => ({ name }) as unknown as CanvasImageSource
const theme = { background: "#05060a" }

const withEyes: ShownArt<CanvasImageSource> = {
  clip: "idle",
  body: image("body"),
  eyes: { sheet: manifest.clips.idle.eyes.calm_day!, image: image("eyes") },
}

// canvas 1000x1000: she's 450 tall (scale 2.25), 225 wide, centred, feet at y 920
describe("drawFrame", () => {
  it("draws only the background before any art has loaded", () => {
    const { calls, asCanvas } = fakeContext()
    drawFrame(asCanvas, 1000, 1000, manifest, null, 0, theme)
    expect(calls).toEqual([])
  })

  it("draws a whole frame once, without a crossfade, exactly on a frame", () => {
    const { calls, asCanvas } = fakeContext()
    drawFrame(asCanvas, 1000, 1000, manifest, { ...withEyes, eyes: null }, 0.5, theme)
    expect(calls).toEqual([
      { image: "body", alpha: 1, from: [100, 200, 100, 200], to: [387.5, 470, 225, 450] },
    ])
  })

  it("crossfades into the next frame by the blend, body then eyes", () => {
    const { ctx, calls, asCanvas } = fakeContext()
    drawFrame(asCanvas, 1000, 1000, manifest, withEyes, 0.625, theme)
    expect(calls.map((call) => [call.image, call.alpha])).toEqual([
      ["body", 1],
      ["body", expect.closeTo(0.25)],
      ["eyes", 1],
      ["eyes", expect.closeTo(0.25)],
    ])
    expect(calls[0]!.from).toEqual([200, 200, 100, 200])
    expect(calls[1]!.from).toEqual([300, 200, 100, 200])
    expect(ctx.globalAlpha).toBe(1)
  })

  it("places the eyes at their offset, scaled with the body", () => {
    const { calls, asCanvas } = fakeContext()
    drawFrame(asCanvas, 1000, 1000, manifest, withEyes, 0, theme)
    const eyes = calls.find((call) => call.image === "eyes")!
    expect(eyes.from).toEqual([0, 0, 20, 10])
    expect(eyes.to).toEqual([387.5 + 40 * 2.25, 470 + 50 * 2.25, 20 * 2.25, 10 * 2.25])
  })

  it("crossfades the last frame into the first", () => {
    const { calls, asCanvas } = fakeContext()
    drawFrame(asCanvas, 1000, 1000, manifest, { ...withEyes, eyes: null }, 0.75, theme)
    expect(calls.map((call) => call.from)).toEqual([[300, 200, 100, 200], [0, 0, 100, 200]])
  })

  it("leaves parts out when their switch is off (measuring fps)", () => {
    const draw = (switches: { nyx: boolean, crossfade: boolean, eyes: boolean }) => {
      const { calls, asCanvas } = fakeContext()
      drawFrame(asCanvas, 1000, 1000, manifest, withEyes, 0.625, theme, { art: true, ...switches })
      return calls.map((call) => call.image)
    }
    expect(draw({ nyx: false, crossfade: true, eyes: true })).toEqual([])
    expect(draw({ nyx: true, crossfade: false, eyes: true })).toEqual(["body", "eyes"])
    expect(draw({ nyx: true, crossfade: true, eyes: false })).toEqual(["body", "body"])
  })

  it("turns smoothing on", () => {
    const { ctx, asCanvas } = fakeContext()
    drawFrame(asCanvas, 1000, 1000, manifest, withEyes, 0, theme)
    expect(ctx.imageSmoothingEnabled).toBe(true)
  })
})
