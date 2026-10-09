import { describe, expect, it } from "vitest"
import { ROOMS, parsePage } from "./rooms"

describe("parsePage", () => {
  it("defaults to the screen view in the dev room without fps", () => {
    expect(parsePage("")).toEqual({
      ok: true,
      page: { view: "screen", room: ROOMS.dev, fps: false },
    })
  })

  it("picks the room from ?room", () => {
    expect(parsePage("?room=selene")).toEqual({
      ok: true,
      page: { view: "screen", room: ROOMS.selene, fps: false },
    })
  })

  it("accepts an explicit screen view", () => {
    expect(parsePage("?view=screen&room=helios")).toEqual({
      ok: true,
      page: { view: "screen", room: ROOMS.helios, fps: false },
    })
  })

  it("turns on fps when ?fps is present, with or without a value", () => {
    expect(parsePage("?room=dev&fps")).toMatchObject({ ok: true, page: { fps: true } })
    expect(parsePage("?fps=1")).toMatchObject({ ok: true, page: { fps: true } })
  })

  it("parses the remote view, ignoring room and fps", () => {
    expect(parsePage("?view=remote")).toEqual({ ok: true, page: { view: "remote" } })
    expect(parsePage("?view=remote&room=selene&fps")).toEqual({
      ok: true,
      page: { view: "remote" },
    })
  })

  it("rejects an unknown room, naming it", () => {
    const result = parsePage("?room=kitchen")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('"kitchen"')
  })

  it("rejects room names that are not presets, even object built-ins", () => {
    expect(parsePage("?room=toString").ok).toBe(false)
    expect(parsePage("?room=Selene").ok).toBe(false)
    expect(parsePage("?room=").ok).toBe(false)
  })

  it("rejects an unknown view", () => {
    const result = parsePage("?view=tv")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('"tv"')
  })

  it("keys every preset by its own room id", () => {
    for (const [key, preset] of Object.entries(ROOMS)) expect(preset.id).toBe(key)
  })

  it("gives Selene a brighter glow than Helios", () => {
    expect(ROOMS.selene.glow).toBeGreaterThan(ROOMS.helios.glow)
  })

  it("makes the big screens opaque and keeps dev transparent", () => {
    expect(ROOMS.helios.opaque).toBe(true)
    expect(ROOMS.selene.opaque).toBe(true)
    expect(ROOMS.dev.opaque).toBe(false)
  })
})
