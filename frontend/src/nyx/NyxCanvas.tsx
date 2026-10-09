import { useEffect, useRef } from "react"
import { readTheme } from "../theme"
import { dayPhase } from "./dayPhase"
import { drawFrame } from "./draw"
import type { NyxView } from "./draw"
import { loadNyxArt } from "./nyxArt"
import type { NyxArt } from "./nyxArt"

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

    let art: NyxArt | null = null
    let stopped = false
    loadNyxArt().then(
      (loaded) => {
        if (!stopped) art = loaded
      },
      (error: unknown) => console.error("could not load Nyx's art", error),
    )

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
      const image = art ? art[dayPhase(new Date())] : null
      drawFrame(ctx, width, height, viewRef.current, time, theme, image)
      frameId = requestAnimationFrame(frame)
    })

    return () => {
      stopped = true
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [opaque, resolution])

  return <canvas key={opaque ? "opaque" : "alpha"} ref={canvasRef} className="nyx-canvas" />
}
