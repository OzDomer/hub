import { useEffect, useRef } from "react"
import { readTheme } from "../theme"
import { drawFrame } from "./draw"
import type { NyxView } from "./draw"

interface NyxCanvasProps {
  view: NyxView | null
}

export function NyxCanvas({ view }: NyxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef(view)

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
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
    })
    observer.observe(canvas)

    let frameId = requestAnimationFrame(function frame(time) {
      drawFrame(ctx, width, height, viewRef.current, time, theme)
      frameId = requestAnimationFrame(frame)
    })

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="nyx-canvas" />
}
