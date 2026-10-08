import type { NyxState, Activity, Stats } from "./nyx"
import type { NyxConfig } from "./config"
import { defaultConfig, HOUR } from "./config"
import { clamp } from "./math"

export function tick(
  nyx: NyxState,
  now: number,
  config: NyxConfig = defaultConfig,
): NyxState {
  const elapsed = now - nyx.lastTickAt
  if (elapsed <= 0) return nyx

  let state = nyx
  let at = nyx.lastTickAt

  while (at < now) {
    const stepEnd = Math.min(at + config.stepMs, now)
    state = step(state, at, stepEnd, config)
    at = stepEnd
  }

  return { ...state, lastTickAt: now }
}

function step(
  state: NyxState,
  from: number,
  to: number,
  config: NyxConfig,
): NyxState {
  const hours = (to - from) / HOUR;

  const activity = endExpiredActivity(state, to)
  const sleeping = activity === "sleeping"

  const stats = drift(state.stats, sleeping, hours, config)

  const next: NyxState = {
    ...state,
    stats,
    activity,
    activityEndsAt: activity === state.activity ? state.activityEndsAt : null,
  };

  return applySleepRules(next, config)
}

function endExpiredActivity(state: NyxState, now: number): Activity {
  if (state.activityEndsAt !== null && now >= state.activityEndsAt) {
    return "idle"
  }
  return state.activity
}

function drift(
  stats: Stats,
  sleeping: boolean,
  hours: number,
  config: NyxConfig,
): Stats {
  const hunger = clamp(stats.hunger + config.hungerPerHour * hours, 0, 100)

  const energyDelta = sleeping
    ? config.energyRecoveryPerHour * hours
    : -config.energyDrainPerHour * hours;
  const energy = clamp(stats.energy + energyDelta, 0, 100)

  const unhappy =
    hunger > config.unhappyAboveHunger || energy < config.unhappyBelowEnergy;
  const happinessDelta = unhappy
    ? -config.happinessDecayPerHour * hours
    : config.happinessRecoveryPerHour * hours
  const happiness = clamp(stats.happiness + happinessDelta, 0, 100)

  return { hunger, energy, happiness }
}

function applySleepRules(state: NyxState, config: NyxConfig): NyxState {
  const { activity, stats } = state

  if (activity === "sleeping") {
    if (stats.energy >= config.wakeAboveEnergy) {
      return { ...state, activity: "idle", activityEndsAt: null }
    }
    return state
  }

  if (activity !== "eating" && stats.energy <= config.sleepBelowEnergy) {
    return { ...state, activity: "sleeping", activityEndsAt: null }
  }

  return state
}