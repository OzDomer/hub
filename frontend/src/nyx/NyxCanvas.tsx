import { useEffect, useRef } from "react"
import type { Activity } from "@hub/core/nyx"
import type { Mood } from "@hub/core/mood"
import { readTheme } from "../theme"
import { dayPhase } from "./dayPhase"
import type { DayPhase } from "./dayPhase"
import { drawFrame } from "./draw"
import { browserNyxArt, nyxManifest } from "./nyxArt"
import type { DrawSwitches } from "./preview"
import { clipFor, eyeVariantFor } from "./sprites"

export interface NyxView {
  activity: Activity
  mood: Mood
}

export interface CanvasSize {
  width: number
  height: number
  ratio: number
}

interface NyxCanvasProps {
  view: NyxView | null
  // forces day or night (the dev preview); null follows the clock
  phase: DayPhase | null
  switches: DrawSwitches
  opaque: boolean
  resolution: number
  onFrame?: (time: number) => void
  onResize?: (size: CanvasSize) => void
}

export function NyxCanvas({ view, phase, switches, opaque, resolution, onFrame, onResize }: NyxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef(view)
  const phaseRef = useRef(phase)
  const switchesRef = useRef(switches)
  const loadArt = switches.art
  const onFrameRef = useRef(onFrame)
  const onResizeRef = useRef(onResize)

  useEffect(() => {
    viewRef.current = view
    phaseRef.current = phase
    switchesRef.current = switches
    onFrameRef.current = onFrame
    onResizeRef.current = onResize
  }, [view, phase, switches, onFrame, onResize])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d", { alpha: !opaque })
    if (!ctx) throw new Error("this browser has no 2d canvas")
    const theme = readTheme()
    const art = loadArt ? browserNyxArt() : null

    let width = 0
    let height = 0
    const observer = new ResizeObserver(() => {
      const ratio = (window.devicePixelRatio || 1) * resolution
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      onResizeRef.current?.({ width: canvas.width, height: canvas.height, ratio })
    })
    observer.observe(canvas)

    let frameId = requestAnimationFrame(function frame(time) {
      onFrameRef.current?.(time)
      const view = viewRef.current
      let shown = null
      if (view !== null) {
        const clip = clipFor(view.activity)
        const eyes = eyeVariantFor(nyxManifest, clip, view.mood, phaseRef.current ?? dayPhase(new Date()))
        shown = art?.pick(clip, eyes, time) ?? null
      }
      drawFrame(ctx, width, height, nyxManifest, shown, time / 1000, theme, switchesRef.current)
      frameId = requestAnimationFrame(frame)
    })

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      art?.dispose()
    }
  }, [opaque, resolution, loadArt])

  return <canvas key={opaque ? "opaque" : "alpha"} ref={canvasRef} className="nyx-canvas" />
}
