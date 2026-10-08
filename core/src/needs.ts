import type { NyxConfig } from "./config"

export function isHungry(hunger: number, config: NyxConfig): boolean {
  return hunger > config.unhappyAboveHunger
}

export function isTired(
  energy: number,
  sleeping: boolean,
  config: NyxConfig,
): boolean {
  return !sleeping && energy < config.unhappyBelowEnergy
}