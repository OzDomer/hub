import { useMemo, useState } from "react"
import { createFpsMeter } from "../debug/fpsMeter"
import { statusText } from "../hub/connection"
import { useHub } from "../hub/useHub"
import { NyxCanvas } from "../nyx/NyxCanvas"
import type { CanvasSize } from "../nyx/NyxCanvas"
import type { NyxView } from "../nyx/draw"
import type { RoomPreset } from "../rooms"

interface ScreenViewProps {
  room: RoomPreset
  fps: boolean
}

export function ScreenView({ room, fps }: ScreenViewProps) {
  const { nyx, status } = useHub(room.id)
  const [fpsReport, setFpsReport] = useState("measuring fps...")
  const [canvasSize, setCanvasSize] = useState<CanvasSize | null>(null)

  const countFrame = useMemo(() => (fps ? createFpsMeter(setFpsReport) : undefined), [fps])

  const view = useMemo<NyxView | null>(
    () => (nyx ? { activity: nyx.state.activity, mood: nyx.mood } : null),
    [nyx],
  )

  return (
    <main className="screen">
      <NyxCanvas
        view={view}
        glow={room.glow}
        opaque={room.opaque}
        onFrame={countFrame}
        onResize={fps ? setCanvasSize : undefined}
      />
      {fps && (
        <div className="debug-overlay">
          <div>{room.id}: {statusText(status)}</div>
          <div>{fpsReport}</div>
          {canvasSize && (
            <div>
              canvas {canvasSize.width}x{canvasSize.height}, devicePixelRatio {canvasSize.ratio}
            </div>
          )}
        </div>
      )}
    </main>
  )
}
