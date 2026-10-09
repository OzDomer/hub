import { useEffect, useRef } from "react"
import type { Activity } from "@hub/core/nyx"
import type { Mood } from "@hub/core/mood"
import { readTheme } from "../theme"
import { dayPhase } from "./dayPhase"
import { drawFrame } from "./draw"
import { browserNyxArt, nyxManifest } from "./nyxArt"
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
  opaque: boolean
  resolution: number
  onFrame?: (time: number) => void
  onResize?: (size: CanvasSize) => void
}

export function NyxCanvas({ view, opaque, resolution, onFrame, onResize }: NyxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef(view)
  const onFrameRef = useRef(onFrame)
  const onResizeRef = useRef(onResize)

  useEffect(() => {
    viewRef.current = view
    onFrameRef.current = onFrame
    onResizeRef.current = onResize
  }, [view, onFrame, onResize])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d", { alpha: !opaque })
    if (!ctx) throw new Error("this browser has no 2d canvas")
    const theme = readTheme()
    const art = browserNyxArt()

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
        const eyes = eyeVariantFor(nyxManifest, clip, view.mood, dayPhase(new Date()))
        shown = art.pick(clip, eyes, time)
      }
      drawFrame(ctx, width, height, nyxManifest, shown, time / 1000, theme)
      frameId = requestAnimationFrame(frame)
    })

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      art.dispose()
    }
  }, [opaque, resolution])

  return <canvas key={opaque ? "opaque" : "alpha"} ref={canvasRef} className="nyx-canvas" />
}
