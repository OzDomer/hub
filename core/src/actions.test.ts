import { describe, it, expect } from "vitest"
import { createNyx } from "./nyx"
import { applyAction } from "./actions"
import { tick } from "./tick"
import { defaultConfig, HOUR, MINUTE } from "./config"

const T0 = 1000 * MINUTE

describe("applyAction", () => {
  it("feed lowers hunger and starts eating for the configured duration", () => {
    const fed = applyAction(createNyx(T0), "feed", T0)
    expect(fed.stats.hunger).toBe(0)
    expect(fed.activity).toBe("eating")
    expect(fed.activityEndsAt).toBe(T0 + defaultConfig.eatDurationMs)
  })

  it("every action is ignored while eating", () => {
    const eating = { ...createNyx(T0), activity: "eating" as const, activityEndsAt: T0 + MINUTE }
    for (const action of ["feed", "play", "pet", "wake"] as const) {
      expect(applyAction(eating, action, T0)).toBe(eating)
    }
  })

  it("play is ignored while sleeping, wake is not", () => {
    const asleep = { ...createNyx(T0), activity: "sleeping" as const }
    expect(applyAction(asleep, "play", T0)).toBe(asleep)
    expect(applyAction(asleep, "wake", T0).activity).toBe("idle")
  })

  it("wake does nothing to an awake Nyx", () => {
    const awake = createNyx(T0)
    expect(applyAction(awake, "wake", T0)).toBe(awake)
  })

  it("stats never leave 0-100", () => {
    const happy = { ...createNyx(T0), stats: { hunger: 0, energy: 100, happiness: 99 } }
    expect(applyAction(happy, "pet", T0).stats.happiness).toBe(100)
  })

  it("a woken Nyx stays awake for the grace period, then sleeps again if still tired", () => {
    const fast = { ...defaultConfig, energyDrainPerHour: 60 }
    const asleep = tick(createNyx(T0), T0 + HOUR, fast)
    const woken = applyAction(asleep, "wake", T0 + HOUR, fast)
    expect(woken.activity).toBe("idle")

    expect(tick(woken, T0 + HOUR + 20 * MINUTE, fast).activity).toBe("idle")
    expect(
      tick(woken, T0 + HOUR + defaultConfig.wakeGraceMs + MINUTE, fast).activity,
    ).toBe("sleeping")
  })

    it("an expired meal doesn't block actions, even before the next tick", () => {
    const ate = { ...createNyx(T0), activity: "eating" as const, activityEndsAt: T0 + 30_000 }
    expect(applyAction(ate, "play", T0 + 45_000).activity).toBe("playing")
  })
})