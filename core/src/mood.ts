import type { NyxState } from "./nyx"
import type { NyxConfig } from "./config"
import { defaultConfig } from "./config"
import { isHungry, isTired } from "./needs"

export type Mood = "happy" | "content" | "sad" | "grumpy"

export function moodOf(nyx: NyxState, config: NyxConfig = defaultConfig): Mood {
    const { hunger, energy, happiness } = nyx.stats
    const sleeping = nyx.activity === "sleeping"

    if (isHungry(hunger, config) || isTired(energy, sleeping, config)) {
        return "grumpy"
    }

    if (happiness >= config.happyAtLeast) return "happy"
    if (happiness < config.sadBelow) return "sad"
    return "content"
}