import { describe, it, expect } from "vitest"
import { createNyx } from "./nyx"
import { moodOf } from "./mood"
import { MINUTE } from "./config"

const T0 = 1000 * MINUTE

function withStats(hunger: number, energy: number, happiness: number) {
  return { ...createNyx(T0), stats: { hunger, energy, happiness } }
}

describe("moodOf", () => {
  it("is happy, content or sad by happiness when needs are met", () => {
    expect(moodOf(withStats(20, 80, 70))).toBe("happy")
    expect(moodOf(withStats(20, 80, 50))).toBe("content")
    expect(moodOf(withStats(20, 80, 29))).toBe("sad")
  })

  it("is grumpy when hungry, even if happy", () => {
    expect(moodOf(withStats(61, 80, 90))).toBe("grumpy")
  })

  it("is grumpy when tired and awake", () => {
    expect(moodOf(withStats(20, 29, 90))).toBe("grumpy")
  })

  it("is not grumpy from tiredness while asleep, only from hunger", () => {
    const tiredSleeper = { ...withStats(20, 10, 90), activity: "sleeping" as const }
    expect(moodOf(tiredSleeper)).toBe("happy")

    const hungrySleeper = { ...withStats(61, 10, 90), activity: "sleeping" as const }
    expect(moodOf(hungrySleeper)).toBe("grumpy")
  })
})