import type { Activity } from "@hub/core/nyx"
import type { Mood } from "@hub/core/mood"
import type { DayPhase } from "./dayPhase"
import type { NyxView } from "./NyxCanvas"
import { CLIP_BY_ACTIVITY, EYES_BY_MOOD } from "./sprites"

// Dev-only URL params that force what a screen shows (?activity=sleeping&mood=sad&phase=night),
// for looking at every clip without waiting for Nyx to do it, and switches that turn
// parts off for measuring fps (&noart, &nonyx, &nocrossfade, &noeyes).
// Ignored in production builds.
export interface Preview {
  activity?: Activity
  mood?: Mood
  phase?: DayPhase
  switches?: DrawSwitches
}

export interface DrawSwitches {
  // false: no sheets loaded at all (nyx: false still loads them, only skips drawing)
  art: boolean
  nyx: boolean
  crossfade: boolean
  eyes: boolean
}

export const ALL_ON: DrawSwitches = { art: true, nyx: true, crossfade: true, eyes: true }

export type PreviewResult =
  | { ok: true, preview: Preview }
  | { ok: false, message: string }

const ACTIVITIES = Object.keys(CLIP_BY_ACTIVITY) as Activity[]
const MOODS = Object.keys(EYES_BY_MOOD) as Mood[]
const PHASES: DayPhase[] = ["day", "night"]

function isOneOf<T extends string>(value: string, known: readonly T[]): value is T {
  return (known as readonly string[]).includes(value)
}

function unknown(name: string, value: string, known: readonly string[]): PreviewResult {
  return { ok: false, message: `unknown ${name} "${value}" (known: ${known.join(", ")})` }
}

export function parsePreview(search: string, enabled: boolean): PreviewResult {
  if (!enabled) return { ok: true, preview: {} }
  const params = new URLSearchParams(search)
  const activity = params.get("activity")
  const mood = params.get("mood")
  const phase = params.get("phase")

  if (activity !== null && !isOneOf(activity, ACTIVITIES)) return unknown("activity", activity, ACTIVITIES)
  if (mood !== null && !isOneOf(mood, MOODS)) return unknown("mood", mood, MOODS)
  if (phase !== null && !isOneOf(phase, PHASES)) return unknown("phase", phase, PHASES)

  const preview: Preview = {}
  if (activity !== null) preview.activity = activity
  if (mood !== null) preview.mood = mood
  if (phase !== null) preview.phase = phase
  if (["noart", "nonyx", "nocrossfade", "noeyes"].some((name) => params.has(name))) {
    preview.switches = {
      art: !params.has("noart"),
      nyx: !params.has("nonyx"),
      crossfade: !params.has("nocrossfade"),
      eyes: !params.has("noeyes"),
    }
  }
  return { ok: true, preview }
}

// for the fps overlay: which parts are off, so a reading can't be mistaken for another
export function switchesText(switches: DrawSwitches): string {
  const off = Object.entries(switches).filter(([, on]) => !on).map(([name]) => `no${name}`)
  return off.length === 0 ? "everything drawn" : off.join(", ")
}

// The preview's fields over the hub's view. A preview also shows Nyx with no hub
// connected, filling the gaps with idle and content.
export function viewOf(hub: NyxView | null, preview: Preview): NyxView | null {
  const previewing = preview.activity !== undefined || preview.mood !== undefined || preview.phase !== undefined
  if (hub === null && !previewing) return null
  return {
    activity: preview.activity ?? hub?.activity ?? "idle",
    mood: preview.mood ?? hub?.mood ?? "content",
  }
}
