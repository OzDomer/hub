import { describe, it, expect } from "vitest"
import { createNyx } from "./nyx"
import { tick } from "./tick"
import { defaultConfig, HOUR, MINUTE } from "./config"

const T0 = 1000 * MINUTE

describe("tick", () => {
  it("returns the same object when no time has passed or time went backwards", () => {
    const nyx = createNyx(T0)
    expect(tick(nyx, T0)).toBe(nyx)
    expect(tick(nyx, T0 - 1000)).toBe(nyx)
  })

  it("one long tick equals many short ticks", () => {
    const start = createNyx(T0)

    const oneCall = tick(start, T0 + 8 * HOUR)

    let manyCalls = start
    for (let i = 1; i <= 480; i++) {
      manyCalls = tick(manyCalls, T0 + i * MINUTE)
    }

    expect(oneCall).toEqual(manyCalls)
  })

  it("falls asleep when energy drops to the threshold, and not before", () => {
    const fast = { ...defaultConfig, energyDrainPerHour: 60 }
    const start = createNyx(T0) // energy 80 -> hits 20 after exactly 1h

    expect(tick(start, T0 + 59 * MINUTE, fast).activity).toBe("idle")
    expect(tick(start, T0 + 60 * MINUTE, fast).activity).toBe("sleeping")
  })

  it("wakes only once energy recovers past the wake threshold (hysteresis)", () => {
    const fast = { ...defaultConfig, energyDrainPerHour: 60, energyRecoveryPerHour: 60 }
    const asleep = tick(createNyx(T0), T0 + 1 * HOUR, fast) // energy 20, sleeping

    const later = tick(asleep, T0 + 1 * HOUR + 30 * MINUTE, fast) // energy 50
    expect(later.activity).toBe("sleeping")

    const rested = tick(asleep, T0 + 1 * HOUR + 70 * MINUTE, fast) // energy 90
    expect(rested.activity).toBe("idle")
  })

  it("keeps hunger rising while asleep", () => {
    const fast = { ...defaultConfig, energyDrainPerHour: 60 }
    const asleep = tick(createNyx(T0), T0 + 1 * HOUR, fast)
    const later = tick(asleep, T0 + 3 * HOUR, fast)
    expect(later.stats.hunger).toBeGreaterThan(asleep.stats.hunger)
  })

  it("ends a timed activity at its end time, not at the end of the gap", () => {
    const start = { ...createNyx(T0), activity: "playing" as const, activityEndsAt: T0 + 5 * MINUTE }
    const fast = { ...defaultConfig, energyDrainPerHour: 60 }

    expect(tick(start, T0 + 4 * MINUTE, fast).activity).toBe("playing")
    expect(tick(start, T0 + 6 * MINUTE, fast).activity).toBe("idle")
    expect(tick(start, T0 + 6 * MINUTE, fast).activityEndsAt).toBeNull()
  })

  it("can fall asleep mid-play, but never mid-meal", () => {
    const fast = { ...defaultConfig, energyDrainPerHour: 60 }
    const tired = { ...createNyx(T0), stats: { hunger: 20, energy: 21, happiness: 70 } }

    const playing = { ...tired, activity: "playing" as const, activityEndsAt: T0 + 10 * MINUTE }
    expect(tick(playing, T0 + 5 * MINUTE, fast).activity).toBe("sleeping")

    const eating = { ...tired, activity: "eating" as const, activityEndsAt: T0 + 10 * MINUTE }
    expect(tick(eating, T0 + 5 * MINUTE, fast).activity).toBe("eating")
  })

  it("gives the same result no matter how often it is ticked", () => {
    const fast = { ...defaultConfig, energyDrainPerHour: 60 }
    const end = T0 + 8 * HOUR

    const oneCall = tick(createNyx(T0), end, fast)

    let irregular = createNyx(T0)
    let t = T0
    while (t < end) {
      t = Math.min(t + 37_000, end)
      irregular = tick(irregular, t, fast)
    }

    expect(irregular).toEqual(oneCall)
  })
  it("processes only whole steps and keeps the leftover for later", () => {
    const start = createNyx(T0)
    const partial = tick(start, T0 + 2 * MINUTE + 50_000)
    expect(partial.lastTickAt).toBe(T0 + 2 * MINUTE)
    expect(tick(start, T0 + 50_000)).toBe(start)
  })
  it("does not lose happiness from tiredness while asleep", () => {
    const sleepy = {
      ...createNyx(T0),
      activity: "sleeping" as const,
      stats: { hunger: 20, energy: 10, happiness: 50 },
    }
    expect(tick(sleepy, T0 + HOUR).stats.happiness).toBeGreaterThan(50)
  })
})