import manifestJson from "../assets/nyx/nyx.json"
import type { ClipName, EyeSheet, NyxManifest } from "./sprites"

export const nyxManifest: NyxManifest = manifestJson

// Sprite sheets are big once decoded (an 8 s body sheet is 5436x4248 px x 4 bytes,
// ~92 MB), so they're loaded per sheet when needed and released when unused.
// Idle's body sheet is pinned: it's where she returns after every other clip.
export const KEEP_MS = 60_000
export const RETRY_MS = 10_000

export interface ShownArt<T> {
  clip: ClipName
  body: T
  eyes: { sheet: EyeSheet, image: T } | null
}

export interface NyxArt<T> {
  // What to draw now. Asks for the art of `clip` with the eye variant `eyes`, but
  // keeps returning what's already shown until all of the new art is decoded.
  // null only before anything has loaded.
  pick(clip: ClipName, eyes: string | null, now: number): ShownArt<T> | null
  dispose(): void
}

export interface NyxArtOptions<T> {
  load: (sheet: string) => Promise<T>
  release: (image: T) => void
  onError?: (sheet: string, error: unknown) => void
}

interface Entry<T> {
  image: T | null
  failed: boolean
  requestedAt: number
  lastUsed: number
}

export function createNyxArt<T>(manifest: NyxManifest, options: NyxArtOptions<T>): NyxArt<T> {
  const { load, release, onError = () => {} } = options
  const entries = new Map<string, Entry<T>>()
  const pinned = manifest.clips.idle.sheet
  let shown: ShownArt<T> | null = null
  let disposed = false

  // the image if it's ready; otherwise starts (or retries) loading it and returns null
  function request(sheet: string, now: number): T | null {
    let entry = entries.get(sheet)
    if (entry?.failed && now - entry.requestedAt >= RETRY_MS) {
      entries.delete(sheet)
      entry = undefined
    }
    if (entry) {
      entry.lastUsed = now
      return entry.image
    }

    const fresh: Entry<T> = { image: null, failed: false, requestedAt: now, lastUsed: now }
    entries.set(sheet, fresh)
    load(sheet).then(
      (image) => {
        // released (or disposed) while it was still loading: nobody wants it now
        if (disposed || entries.get(sheet) !== fresh) release(image)
        else fresh.image = image
      },
      (error: unknown) => {
        fresh.failed = true
        onError(sheet, error)
      },
    )
    return null
  }

  function touch(sheet: string, now: number): void {
    const entry = entries.get(sheet)
    if (entry) entry.lastUsed = now
  }

  function sweep(now: number): void {
    for (const [sheet, entry] of entries) {
      if (now - entry.lastUsed < KEEP_MS) continue
      entries.delete(sheet)
      if (entry.image !== null) release(entry.image)
    }
  }

  request(pinned, 0)

  return {
    pick(clip, eyes, now) {
      if (disposed) return null
      const eyeSheet = eyes === null ? null : manifest.clips[clip].eyes[eyes] ?? null
      const body = request(manifest.clips[clip].sheet, now)
      const eyeImage = eyeSheet === null ? null : request(eyeSheet.sheet, now)
      // asking for idle every frame is what pins it (and retries it if its load failed)
      request(pinned, now)

      const ready = body !== null && (eyeSheet === null || eyeImage !== null)
      // a new object only when something changed, not a fresh one every frame
      const changed = shown?.body !== body || (shown.eyes?.image ?? null) !== eyeImage
      if (ready && changed) {
        shown = {
          clip,
          body,
          eyes: eyeSheet !== null && eyeImage !== null ? { sheet: eyeSheet, image: eyeImage } : null,
        }
      }

      // what's on screen is in use, even while it stands in for something else
      if (shown !== null) {
        touch(manifest.clips[shown.clip].sheet, now)
        if (shown.eyes !== null) touch(shown.eyes.sheet.sheet, now)
      }
      sweep(now)
      return shown
    },

    dispose() {
      disposed = true
      shown = null
      for (const entry of entries.values()) {
        if (entry.image !== null) release(entry.image)
      }
      entries.clear()
    },
  }
}

const sheetUrls = import.meta.glob<string>("../assets/nyx/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
})

// ImageBitmap, not <img>: it stays decoded until close() (an <img> may be thrown
// away and decoded again on the next draw, a hitch for a 92 MB sheet), and close()
// frees the memory now instead of whenever the garbage collector runs.
async function loadBitmap(sheet: string): Promise<ImageBitmap> {
  const url = sheetUrls[`../assets/nyx/${sheet}`]
  if (url === undefined) throw new Error(`no sprite sheet named ${sheet}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${sheet}: HTTP ${response.status}`)
  return createImageBitmap(await response.blob())
}

export function browserNyxArt(): NyxArt<ImageBitmap> {
  return createNyxArt(nyxManifest, {
    load: loadBitmap,
    release: (bitmap) => bitmap.close(),
    onError: (sheet, error) => console.error(`could not load ${sheet}`, error),
  })
}
