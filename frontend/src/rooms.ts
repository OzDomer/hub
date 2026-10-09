export interface RoomPreset {
  id: string
  opaque: boolean
  resolution: number
}

export const ROOMS = {
  dev: { id: "dev", opaque: false, resolution: 1 },
  helios: { id: "helios", opaque: true, resolution: 1 },
  selene: { id: "selene", opaque: true, resolution: 0.7 },
} as const satisfies Record<string, RoomPreset>

export type RoomId = keyof typeof ROOMS

export type Page =
  | { view: "screen", room: RoomPreset, fps: boolean }
  | { view: "remote" }

export type PageResult =
  | { ok: true, page: Page }
  | { ok: false, message: string }

function isRoomId(name: string): name is RoomId {
  return Object.hasOwn(ROOMS, name)
}

export function parsePage(search: string): PageResult {
  const params = new URLSearchParams(search)
  const view = params.get("view") ?? "screen"

  if (view === "remote") return { ok: true, page: { view: "remote" } }
  if (view !== "screen") {
    return { ok: false, message: `unknown view "${view}" (known: screen, remote)` }
  }

  const room = params.get("room") ?? "dev"
  if (!isRoomId(room)) {
    const known = Object.keys(ROOMS).join(", ")
    return { ok: false, message: `unknown room "${room}" (known: ${known})` }
  }

  return { ok: true, page: { view: "screen", room: ROOMS[room], fps: params.has("fps") } }
}
