import { useMemo, useState } from "react"
import { createFpsMeter } from "../debug/fpsMeter"
import { statusText } from "../hub/connection"
import { useHub } from "../hub/useHub"
import { NyxCanvas } from "../nyx/NyxCanvas"
import type { NyxView } from "../nyx/draw"
import type { RoomPreset } from "../rooms"

interface ScreenViewProps {
  room: RoomPreset
  fps: boolean
}

export function ScreenView({ room, fps }: ScreenViewProps) {
  const { nyx, status } = useHub(room.id)
  const [fpsReport, setFpsReport] = useState("measuring fps...")

  const countFrame = useMemo(() => (fps ? createFpsMeter(setFpsReport) : undefined), [fps])

  const view = useMemo<NyxView | null>(
    () => (nyx ? { activity: nyx.state.activity, mood: nyx.mood } : null),
    [nyx],
  )

  return (
    <main className="screen">
      <NyxCanvas view={view} glow={room.glow} onFrame={countFrame} />
      {fps && (
        <div className="debug-overlay">
          <div>{room.id}: {statusText(status)}</div>
          <div>{fpsReport}</div>
        </div>
      )}
    </main>
  )
}
