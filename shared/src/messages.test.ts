import { describe, it, expect } from "vitest"
import { parseClientMessage } from "./messages"

function parse(message: unknown) {
  return parseClientMessage(JSON.stringify(message))
}

describe("parseClientMessage", () => {
  it("accepts a valid hello", () => {
    expect(parse({ type: "hello", room: "dev", topics: ["nyx"] })).toEqual({
      ok: true,
      message: { type: "hello", room: "dev", topics: ["nyx"] },
    })
  })

  it("accepts a valid act", () => {
    expect(parse({ type: "act", action: "feed" })).toEqual({
      ok: true,
      message: { type: "act", action: "feed" },
    })
  })

  it("rejects text that isn't JSON", () => {
    expect(parseClientMessage("feed her").ok).toBe(false)
  })

  it("rejects unknown types, actions and topics", () => {
    expect(parse({ type: "dance" }).ok).toBe(false)
    expect(parse({ type: "act", action: "bathe" }).ok).toBe(false)
    expect(parse({ type: "hello", room: "dev", topics: ["weather"] }).ok).toBe(false)
  })

  it("rejects a hello without topics or with an empty room", () => {
    expect(parse({ type: "hello", room: "dev", topics: [] }).ok).toBe(false)
    expect(parse({ type: "hello", room: "", topics: ["nyx"] }).ok).toBe(false)
  })

  it("drops fields it doesn't know", () => {
    expect(parse({ type: "act", action: "feed", admin: true })).toEqual({
      ok: true,
      message: { type: "act", action: "feed" },
    })
  })
})