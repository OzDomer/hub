export type Activity = "idle" | "sleeping" | "eating" | "playing";

export interface Stats {
  readonly hunger: number;    // 0 = full, 100 = starving
  readonly energy: number;    // 0 = exhausted, 100 = fully rested
  readonly happiness: number; // 0 = miserable, 100 = ecstatic
}

export interface NyxState {
  readonly stats: Stats;
  readonly activity: Activity;
  readonly activityEndsAt: number | null;
  readonly lastTickAt: number;
}

export function createNyx(now: number): NyxState {
  return {
    stats: { hunger: 20, energy: 80, happiness: 70 },
    activity: "idle",
    activityEndsAt: null,
    lastTickAt: now,
  };
}