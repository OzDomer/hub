import { describe, expect, it } from "vitest"
import { parsePreview, switchesText, viewOf } from "./preview"

describe("parsePreview", () => {
  it("is empty without params", () => {
    expect(parsePreview("", true)).toEqual({ ok: true, preview: {} })
  })

  it("reads activity, mood and phase", () => {
    expect(parsePreview("?room=dev&activity=sleeping&mood=sad&phase=night", true)).toEqual({
      ok: true,
      preview: { activity: "sleeping", mood: "sad", phase: "night" },
    })
  })

  it("rejects unknown values with the known ones", () => {
    expect(parsePreview("?activity=walking", true)).toEqual({
      ok: false,
      message: 'unknown activity "walking" (known: idle, sleeping, eating, playing)',
    })
    expect(parsePreview("?mood=ecstatic", true)).toMatchObject({ ok: false })
    expect(parsePreview("?phase=dusk", true)).toMatchObject({ ok: false })
  })

  it("reads the drawing switches", () => {
    expect(parsePreview("?room=selene&fps&nocrossfade", true)).toEqual({
      ok: true,
      preview: { switches: { art: true, nyx: true, crossfade: false, eyes: true } },
    })
    expect(parsePreview("?nonyx&noeyes", true)).toMatchObject({
      preview: { switches: { art: true, nyx: false, crossfade: true, eyes: false } },
    })
    expect(parsePreview("?noart", true)).toMatchObject({
      preview: { switches: { art: false, nyx: true, crossfade: true, eyes: true } },
    })
  })

  it("names the switches that are off", () => {
    expect(switchesText({ art: true, nyx: true, crossfade: false, eyes: false })).toBe("nocrossfade, noeyes")
    expect(switchesText({ art: true, nyx: true, crossfade: true, eyes: true })).toBe("everything drawn")
  })

  it("ignores everything when disabled (production builds)", () => {
    expect(parsePreview("?activity=sleeping&phase=dusk&nonyx", false)).toEqual({ ok: true, preview: {} })
  })
})

describe("viewOf", () => {
  const hub = { activity: "eating", mood: "grumpy" } as const

  it("is the hub's view without a preview", () => {
    expect(viewOf(hub, {})).toEqual(hub)
    expect(viewOf(null, {})).toBeNull()
  })

  it("lays the preview's fields over the hub's", () => {
    expect(viewOf(hub, { activity: "sleeping" })).toEqual({ activity: "sleeping", mood: "grumpy" })
    expect(viewOf(hub, { mood: "happy" })).toEqual({ activity: "eating", mood: "happy" })
  })

  it("doesn't show Nyx without a hub for the switches alone", () => {
    expect(viewOf(null, { switches: { art: true, nyx: true, crossfade: false, eyes: true } })).toBeNull()
  })

  it("shows Nyx without a hub when previewing, with idle and content for the gaps", () => {
    expect(viewOf(null, { activity: "playing" })).toEqual({ activity: "playing", mood: "content" })
    expect(viewOf(null, { phase: "night" })).toEqual({ activity: "idle", mood: "content" })
  })
})
