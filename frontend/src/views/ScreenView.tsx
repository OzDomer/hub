import { useMemo, useState } from "react"
import { createFpsMeter } from "../debug/fpsMeter"
import { statusText } from "../hub/connection"
import { useHub } from "../hub/useHub"
import { NyxCanvas } from "../nyx/NyxCanvas"
import type { CanvasSize, NyxView } from "../nyx/NyxCanvas"
import { ALL_ON, switchesText, viewOf } from "../nyx/preview"
import type { Preview } from "../nyx/preview"
import type { RoomPreset } from "../rooms"

interface ScreenViewProps {
  room: RoomPreset
  fps: boolean
  preview: Preview
}

export function ScreenView({ room, fps, preview }: ScreenViewProps) {
  const { nyx, status } = useHub(room.id)
  const [fpsReport, setFpsReport] = useState("measuring fps...")
  const [canvasSize, setCanvasSize] = useState<CanvasSize | null>(null)

  const countFrame = useMemo(() => (fps ? createFpsMeter(setFpsReport) : undefined), [fps])

  const view = useMemo<NyxView | null>(
    () => viewOf(nyx ? { activity: nyx.state.activity, mood: nyx.mood } : null, preview),
    [nyx, preview],
  )

  return (
    <main className="screen">
      <NyxCanvas
        view={view}
        phase={preview.phase ?? null}
        switches={preview.switches ?? ALL_ON}
        opaque={room.opaque}
        resolution={room.resolution}
        onFrame={countFrame}
        onResize={fps ? setCanvasSize : undefined}
      />
      {fps && (
        <div className="debug-overlay">
          <div>{room.id}: {statusText(status)}</div>
          <div>{fpsReport}</div>
          <div>{switchesText(preview.switches ?? ALL_ON)}</div>
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
