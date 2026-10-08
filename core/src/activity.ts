import type { NyxState, Activity } from "./nyx"

export function activityAt(nyx: NyxState, now: number): Activity {
  if (nyx.activityEndsAt !== null && now >= nyx.activityEndsAt) return "idle"
  return nyx.activity
}