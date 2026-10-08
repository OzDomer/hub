import { describe, it, expect } from "vitest"
import { createNyx } from "../src/nyx"

describe("createNyx", () => {
  it("starts idle, with no activity end time", () => {
    const pet = createNyx(1000)
    expect(pet.activity).toBe("idle")
    expect(pet.activityEndsAt).toBeNull()
  })

  it("uses the injected time as lastTickAt", () => {
    expect(createNyx(1000).lastTickAt).toBe(1000)
    expect(createNyx(5000).lastTickAt).toBe(5000)
  })
})