export type DayPhase = "day" | "night"

const NIGHT_STARTS_AT_HOUR = 19
const DAY_STARTS_AT_HOUR = 7

export function dayPhase(date: Date): DayPhase {
  const hour = date.getHours()
  return hour >= NIGHT_STARTS_AT_HOUR || hour < DAY_STARTS_AT_HOUR ? "night" : "day"
}
