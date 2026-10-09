import type { Activity } from "@hub/core/nyx"
import type { Mood } from "@hub/core/mood"
import type { DayPhase } from "./dayPhase"

// The shape of assets/nyx/nyx.json, written by tools/blender/packSprites.py
// (docs/nyxArtPipeline.md, section 9)

export type ClipName = "idle" | "sleep" | "eat" | "play"

export interface EyeSheet {
  sheet: string
  // where the eye frame sits inside the body frame, in art pixels
  x: number
  y: number
  width: number
  height: number
}

export interface Clip {
  frames: number
  sheet: string
  // keyed by "<state>_<phase>", e.g. "calm_day"
  eyes: Record<string, EyeSheet>
}

export interface NyxManifest {
  frameWidth: number
  frameHeight: number
  fps: number
  columns: number
  crossfade: boolean
  clips: Record<ClipName, Clip>
}

export interface FramePosition {
  index: number
  next: number
  // how far we are from index to next, 0..1: the alpha of next in the crossfade
  blend: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function frameAt(frames: number, fps: number, seconds: number): FramePosition {
  const position = seconds * fps
  const whole = Math.floor(position)
  // the double modulo keeps the index positive even for negative time
  const index = ((whole % frames) + frames) % frames
  return { index, next: (index + 1) % frames, blend: position - whole }
}

export function cellRect(index: number, columns: number, width: number, height: number): Rect {
  return {
    x: (index % columns) * width,
    y: Math.floor(index / columns) * height,
    width,
    height,
  }
}

export const CLIP_BY_ACTIVITY: Record<Activity, ClipName> = {
  idle: "idle",
  sleeping: "sleep",
  eating: "eat",
  playing: "play",
}

// idle shows the mood; the other clips have one eye state each
export const EYES_BY_MOOD: Record<Mood, string> = {
  happy: "happy",
  content: "calm",
  sad: "sad",
  grumpy: "grumpy",
}

export const EYES_BY_CLIP: Record<Exclude<ClipName, "idle">, string> = {
  sleep: "closed",
  eat: "content",
  play: "happy",
}

export function clipFor(activity: Activity): ClipName {
  return CLIP_BY_ACTIVITY[activity]
}

export function eyeStateFor(clip: ClipName, mood: Mood): string {
  return clip === "idle" ? EYES_BY_MOOD[mood] : EYES_BY_CLIP[clip]
}

// The key of the eye sheet to draw. A state rendered only by day (sleep's closed
// lids look the same at night) stands in for its night version; anything else
// missing falls back to the clip's first variant, so she never has no eyes.
export function eyeVariantFor(
  manifest: NyxManifest,
  clip: ClipName,
  mood: Mood,
  phase: DayPhase,
): string | null {
  const eyes = manifest.clips[clip].eyes
  const state = eyeStateFor(clip, mood)
  for (const key of [`${state}_${phase}`, `${state}_day`]) {
    if (key in eyes) return key
  }
  return Object.keys(eyes)[0] ?? null
}
