import type { NyxState, Activity, Stats } from "./nyx"
import type { NyxConfig } from "./config"
import { defaultConfig, HOUR } from "./config"
import { clamp } from "./math"

export function tick(
  nyx: NyxState,
  now: number,
  config: NyxConfig = defaultConfig,
): NyxState {
  const steps = Math.floor((now - nyx.lastTickAt) / config.stepMs)
  if (steps <= 0) return nyx

  let state = nyx
  for (let i = 1; i <= steps; i++) {
    state = step(state, nyx.lastTickAt + i * config.stepMs, config)
  }

  return { ...state, lastTickAt: nyx.lastTickAt + steps * config.stepMs }
}

function step(state: NyxState, at: number, config: NyxConfig): NyxState {
  const activity = endExpiredActivity(state, at)
  const sleeping = activity === "sleeping"
  const stats = drift(state.stats, sleeping, config)

  const next: NyxState = {
    ...state,
    stats,
    activity,
    activityEndsAt: activity === state.activity ? state.activityEndsAt : null,
  }

  return applySleepRules(next, at, config)
}

function endExpiredActivity(state: NyxState, now: number): Activity {
  if (state.activityEndsAt !== null && now >= state.activityEndsAt) {
    return "idle"
  }
  return state.activity
}

function drift(stats: Stats, sleeping: boolean, config: NyxConfig): Stats {
  const hours = config.stepMs / HOUR
  const hunger = clamp(stats.hunger + config.hungerPerHour * hours, 0, 100)

  const energyDelta = sleeping
    ? config.energyRecoveryPerHour * hours
    : -config.energyDrainPerHour * hours
  const energy = clamp(stats.energy + energyDelta, 0, 100)

  const unhappy =
    hunger > config.unhappyAboveHunger || energy < config.unhappyBelowEnergy
  const happinessDelta = unhappy
    ? -config.happinessDecayPerHour * hours
    : config.happinessRecoveryPerHour * hours
  const happiness = clamp(stats.happiness + happinessDelta, 0, 100)

  return { hunger, energy, happiness }
}

function applySleepRules(
  state: NyxState,
  now: number,
  config: NyxConfig,
): NyxState {
  const { activity, stats } = state

  if (activity === "sleeping") {
    if (stats.energy >= config.wakeAboveEnergy) {
      return { ...state, activity: "idle", activityEndsAt: null }
    }
    return state
  }

  const forcedAwake =
    state.forcedAwakeUntil !== null && now < state.forcedAwakeUntil

  if (
    activity !== "eating" &&
    !forcedAwake &&
    stats.energy <= config.sleepBelowEnergy
  ) {
    return {
      ...state,
      activity: "sleeping",
      activityEndsAt: null,
      forcedAwakeUntil: null,
    }
  }

  return state
}

