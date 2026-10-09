import { describe, expect, it } from "vitest"
import type { Activity } from "@hub/core/nyx"
import type { Mood } from "@hub/core/mood"
import manifestJson from "../assets/nyx/nyx.json"
import type { DayPhase } from "./dayPhase"
import {
  CLIP_BY_ACTIVITY,
  EYES_BY_MOOD,
  cellRect,
  clipFor,
  eyeStateFor,
  eyeVariantFor,
  frameAt,
  type ClipName,
  type NyxManifest,
} from "./sprites"

const realManifest: NyxManifest = manifestJson

const eyes = { sheet: "x.webp", x: 0, y: 0, width: 10, height: 10 }

const fakeManifest: NyxManifest = {
  frameWidth: 100,
  frameHeight: 120,
  fps: 12,
  columns: 12,
  crossfade: true,
  clips: {
    idle: { frames: 96, sheet: "idle.webp", eyes: { calm_day: eyes, calm_night: eyes, happy_day: eyes } },
    sleep: { frames: 96, sheet: "sleep.webp", eyes: { closed_day: eyes } },
    eat: { frames: 48, sheet: "eat.webp", eyes: {} },
    play: { frames: 48, sheet: "play.webp", eyes: { happy_day: eyes, happy_night: eyes } },
  },
}

const ACTIVITIES = Object.keys(CLIP_BY_ACTIVITY) as Activity[]
const MOODS = Object.keys(EYES_BY_MOOD) as Mood[]
const PHASES: DayPhase[] = ["day", "night"]

describe("frameAt", () => {
  it("starts at frame 0 with no blend", () => {
    expect(frameAt(96, 12, 0)).toEqual({ index: 0, next: 1, blend: 0 })
  })

  it("advances one frame per 1/fps seconds", () => {
    expect(frameAt(96, 12, 1).index).toBe(12)
  })

  it("blends by the fraction of the way to the next frame", () => {
    const frame = frameAt(96, 12, 10.25 / 12)
    expect(frame.index).toBe(10)
    expect(frame.next).toBe(11)
    expect(frame.blend).toBeCloseTo(0.25)
  })

  it("crossfades the last frame into the first", () => {
    const frame = frameAt(96, 12, 95.5 / 12)
    expect(frame.index).toBe(95)
    expect(frame.next).toBe(0)
    expect(frame.blend).toBeCloseTo(0.5)
  })

  it("wraps around after one loop", () => {
    expect(frameAt(48, 12, 4).index).toBe(0)
    expect(frameAt(48, 12, 4 + 3 / 12).index).toBe(3)
    expect(frameAt(48, 12, 100 * 4 + 3 / 12).index).toBe(3)
  })

  it("stays in range for negative time", () => {
    const frame = frameAt(48, 12, -0.5 / 12)
    expect(frame.index).toBe(47)
    expect(frame.next).toBe(0)
    expect(frame.blend).toBeCloseTo(0.5)
  })
})

describe("cellRect", () => {
  it("puts the first frame at the top left", () => {
    expect(cellRect(0, 12, 453, 531)).toEqual({ x: 0, y: 0, width: 453, height: 531 })
  })

  it("puts frame 12 at the start of the second row", () => {
    expect(cellRect(12, 12, 453, 531)).toEqual({ x: 0, y: 531, width: 453, height: 531 })
  })

  it("puts the last frame of a 96-frame sheet at the bottom right", () => {
    expect(cellRect(95, 12, 453, 531)).toEqual({ x: 11 * 453, y: 7 * 531, width: 453, height: 531 })
  })
})

describe("clipFor", () => {
  it.each([
    ["idle", "idle"],
    ["sleeping", "sleep"],
    ["eating", "eat"],
    ["playing", "play"],
  ] as const)("%s plays %s", (activity, clip) => {
    expect(clipFor(activity)).toBe(clip)
  })
})

describe("eyeStateFor", () => {
  it.each([
    ["happy", "happy"],
    ["content", "calm"],
    ["sad", "sad"],
    ["grumpy", "grumpy"],
  ] as const)("idle shows %s as %s eyes", (mood, state) => {
    expect(eyeStateFor("idle", mood)).toBe(state)
  })

  it.each([
    ["sleep", "closed"],
    ["eat", "content"],
    ["play", "happy"],
  ] as const)("%s always has %s eyes, whatever the mood", (clip, state) => {
    for (const mood of MOODS) expect(eyeStateFor(clip, mood)).toBe(state)
  })
})

describe("eyeVariantFor", () => {
  it("picks the variant for the phase", () => {
    expect(eyeVariantFor(fakeManifest, "idle", "content", "day")).toBe("calm_day")
    expect(eyeVariantFor(fakeManifest, "idle", "content", "night")).toBe("calm_night")
  })

  it("uses the day variant when there is no night one", () => {
    expect(eyeVariantFor(fakeManifest, "sleep", "happy", "night")).toBe("closed_day")
    expect(eyeVariantFor(fakeManifest, "idle", "happy", "night")).toBe("happy_day")
  })

  it("falls back to the clip's first variant when the state is missing", () => {
    expect(eyeVariantFor(fakeManifest, "idle", "sad", "night")).toBe("calm_day")
  })

  it("returns null for a clip without eye sheets", () => {
    expect(eyeVariantFor(fakeManifest, "eat", "happy", "day")).toBeNull()
  })
})

describe("the real nyx.json", () => {
  it("has a clip for every activity", () => {
    for (const activity of ACTIVITIES) {
      expect(realManifest.clips[clipFor(activity)]).toBeDefined()
    }
  })

  // stronger than "resolves to something": the fallback to the first variant
  // would pass that, so check the variant shows the intended eye state
  it("has the intended eyes for every clip x mood x phase", () => {
    const clips = Object.keys(realManifest.clips) as ClipName[]
    for (const clip of clips) {
      for (const mood of MOODS) {
        for (const phase of PHASES) {
          const key = eyeVariantFor(realManifest, clip, mood, phase)
          expect(key, `${clip} ${mood} ${phase}`).not.toBeNull()
          expect(realManifest.clips[clip].eyes[key!]).toBeDefined()
          expect(key!.startsWith(`${eyeStateFor(clip, mood)}_`), `${clip} ${mood} ${phase} -> ${key}`).toBe(true)
        }
      }
    }
  })
})
