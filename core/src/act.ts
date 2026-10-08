import type { NyxState, Action } from "./nyx"
import type { NyxConfig } from "./config"
import { defaultConfig } from "./config"
import { tick } from "./tick"
import { applyAction } from "./actions"

export function act(
  nyx: NyxState,
  action: Action,
  now: number,
  config: NyxConfig = defaultConfig,
): NyxState {
  return applyAction(tick(nyx, now, config), action, now, config)
}