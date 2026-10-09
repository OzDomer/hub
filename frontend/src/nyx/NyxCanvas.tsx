import { useEffect, useRef } from "react"
import { readTheme } from "../theme"
import { drawFrame } from "./draw"
import type { NyxView } from "./draw"

export interface CanvasSize {
  width: number
  height: number
  ratio: number
}

interface NyxCanvasProps {
  view: NyxView | null
  glow: number
  opaque: boolean
  onFrame?: (time: number) => void
  onResize?: (size: CanvasSize) => void
}

export function NyxCanvas({ view, glow, opaque, onFrame, onResize }: NyxCanvasProps) {
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

    let width = 0
    let height = 0
    const observer = new ResizeObserver(() => {
      const ratio = window.devicePixelRatio || 1
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
      drawFrame(ctx, width, height, viewRef.current, time, theme, glow)
      frameId = requestAnimationFrame(frame)
    })

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [glow, opaque])

  return <canvas key={opaque ? "opaque" : "alpha"} ref={canvasRef} className="nyx-canvas" />
}
