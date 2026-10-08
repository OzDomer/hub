import type { NyxState } from "./nyx"
import type { NyxConfig } from "./config"
import { defaultConfig } from "./config"

export type Mood = "happy" | "content" | "sad" | "grumpy"

export function moodOf(nyx: NyxState, config: NyxConfig = defaultConfig): Mood {
  const { hunger, energy, happiness } = nyx.stats
  const sleeping = nyx.activity === "sleeping"

  const hungry = hunger > config.unhappyAboveHunger
  const tired = !sleeping && energy < config.unhappyBelowEnergy
  if (hungry || tired) return "grumpy"

  if (happiness >= config.happyAtLeast) return "happy"
  if (happiness < config.sadBelow) return "sad"
  return "content"
}