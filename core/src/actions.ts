import type { NyxState, Action } from "./nyx"
import type { NyxConfig } from "./config"
import { defaultConfig } from "./config"
import { clamp } from "./math"
import { activityAt } from "./activity"

export function applyAction(
  nyx: NyxState,
  action: Action,
  now: number,
  config: NyxConfig = defaultConfig,
): NyxState {
  const activity = activityAt(nyx, now)
  if (activity === "eating") return nyx

  switch (action) {
    case "feed":
      return {
        ...nyx,
        stats: {
          ...nyx.stats,
          hunger: clamp(nyx.stats.hunger - config.feedHungerRelief, 0, 100),
        },
        activity: "eating",
        activityEndsAt: now + config.eatDurationMs,
      }

    case "play":
      if (activity === "sleeping") return nyx
      return {
        ...nyx,
        stats: {
          ...nyx.stats,
          happiness: clamp(nyx.stats.happiness + config.playHappinessGain, 0, 100),
          energy: clamp(nyx.stats.energy - config.playEnergyCost, 0, 100),
        },
        activity: "playing",
        activityEndsAt: now + config.playDurationMs,
      }

    case "pet":
      return {
        ...nyx,
        stats: {
          ...nyx.stats,
          happiness: clamp(nyx.stats.happiness + config.petHappinessGain, 0, 100),
        },
      }

    case "wake":
      if (activity !== "sleeping") return nyx
      return {
        ...nyx,
        activity: "idle",
        activityEndsAt: null,
        forcedAwakeUntil: now + config.wakeGraceMs,
      }
  }
}