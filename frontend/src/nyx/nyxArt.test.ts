import { describe, expect, it } from "vitest"
import { KEEP_MS, RETRY_MS, createNyxArt } from "./nyxArt"
import type { NyxManifest } from "./sprites"

interface FakeImage {
  sheet: string
}

const eye = (sheet: string) => ({ sheet, x: 0, y: 0, width: 10, height: 10 })

const manifest: NyxManifest = {
  frameWidth: 100,
  frameHeight: 120,
  fps: 12,
  columns: 12,
  crossfade: true,
  clips: {
    idle: {
      frames: 96,
      sheet: "idle.webp",
      eyes: { calm_day: eye("idle_calm.webp"), happy_day: eye("idle_happy.webp") },
    },
    sleep: { frames: 96, sheet: "sleep.webp", eyes: { closed_day: eye("sleep_closed.webp") } },
    eat: { frames: 48, sheet: "eat.webp", eyes: {} },
    play: { frames: 48, sheet: "play.webp", eyes: {} },
  },
}

// A loader whose loads finish only when the test says so
function fakeLoader() {
  const pending = new Map<string, { resolve: () => void, reject: (error: Error) => void }>()
  const loads: string[] = []
  const released: string[] = []
  return {
    loads,
    released,
    options: {
      load: (sheet: string) => {
        loads.push(sheet)
        return new Promise<FakeImage>((resolve, reject) => {
          pending.set(sheet, { resolve: () => resolve({ sheet }), reject })
        })
      },
      release: (image: FakeImage) => {
        released.push(image.sheet)
      },
    },
    async finish(...sheets: string[]) {
      for (const sheet of sheets) pending.get(sheet)!.resolve()
      await flush()
    },
    async fail(sheet: string) {
      pending.get(sheet)!.reject(new Error("404"))
      await flush()
    },
  }
}

// lets the loader's .then callbacks run
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function sheetsOf(shown: { body: FakeImage, eyes: { image: FakeImage } | null } | null) {
  return shown === null ? null : [shown.body.sheet, shown.eyes?.image.sheet ?? null]
}

async function idleShowing() {
  const loader = fakeLoader()
  const art = createNyxArt(manifest, loader.options)
  art.pick("idle", "calm_day", 0)
  await loader.finish("idle.webp", "idle_calm.webp")
  // the next frame puts it on screen
  expect(art.pick("idle", "calm_day", 0)?.clip).toBe("idle")
  return { loader, art }
}

describe("createNyxArt", () => {
  it("starts loading idle's body right away", () => {
    const loader = fakeLoader()
    createNyxArt(manifest, loader.options)
    expect(loader.loads).toEqual(["idle.webp"])
  })

  it("shows nothing until the body and the eyes have both loaded", async () => {
    const loader = fakeLoader()
    const art = createNyxArt(manifest, loader.options)
    expect(art.pick("idle", "calm_day", 0)).toBeNull()
    await loader.finish("idle.webp")
    expect(art.pick("idle", "calm_day", 10)).toBeNull()
    await loader.finish("idle_calm.webp")
    expect(sheetsOf(art.pick("idle", "calm_day", 20))).toEqual(["idle.webp", "idle_calm.webp"])
  })

  it("loads each sheet once", async () => {
    const { loader, art } = await idleShowing()
    for (let now = 0; now < 1000; now += 16) art.pick("idle", "calm_day", now)
    expect(loader.loads).toEqual(["idle.webp", "idle_calm.webp"])
  })

  it("returns the same object while nothing changes", async () => {
    const { art } = await idleShowing()
    expect(art.pick("idle", "calm_day", 100)).toBe(art.pick("idle", "calm_day", 116))
  })

  it("keeps showing idle until the new clip's body and eyes are decoded", async () => {
    const { loader, art } = await idleShowing()
    expect(art.pick("sleep", "closed_day", 100)?.clip).toBe("idle")
    await loader.finish("sleep.webp")
    expect(art.pick("sleep", "closed_day", 200)?.clip).toBe("idle")
    await loader.finish("sleep_closed.webp")
    expect(sheetsOf(art.pick("sleep", "closed_day", 300))).toEqual(["sleep.webp", "sleep_closed.webp"])
  })

  it("keeps the old eyes until the new mood's eyes are decoded", async () => {
    const { loader, art } = await idleShowing()
    expect(sheetsOf(art.pick("idle", "happy_day", 100))).toEqual(["idle.webp", "idle_calm.webp"])
    await loader.finish("idle_happy.webp")
    expect(sheetsOf(art.pick("idle", "happy_day", 200))).toEqual(["idle.webp", "idle_happy.webp"])
  })

  it("shows a clip without eye sheets once its body has loaded", async () => {
    const { loader, art } = await idleShowing()
    art.pick("eat", null, 100)
    await loader.finish("eat.webp")
    expect(sheetsOf(art.pick("eat", null, 200))).toEqual(["eat.webp", null])
  })

  it("releases a clip after KEEP_MS unused, but never idle's body", async () => {
    const { loader, art } = await idleShowing()
    art.pick("sleep", "closed_day", 0)
    await loader.finish("sleep.webp", "sleep_closed.webp")
    art.pick("sleep", "closed_day", 1000)
    art.pick("idle", "calm_day", 2000)

    art.pick("idle", "calm_day", 1000 + KEEP_MS - 1)
    expect(loader.released).toEqual([])
    art.pick("idle", "calm_day", 1000 + KEEP_MS)
    expect(loader.released.sort()).toEqual(["sleep.webp", "sleep_closed.webp"])

    art.pick("sleep", "closed_day", 10 * KEEP_MS)
    art.pick("sleep", "closed_day", 20 * KEEP_MS)
    expect(loader.released).not.toContain("idle.webp")
  })

  it("keeps idle's body loaded while another clip plays for a long time", async () => {
    const { loader, art } = await idleShowing()
    art.pick("sleep", "closed_day", 0)
    await loader.finish("sleep.webp", "sleep_closed.webp")
    for (let now = 0; now <= 2 * KEEP_MS; now += 1000) {
      expect(art.pick("sleep", "closed_day", now)?.clip).toBe("sleep")
    }
    expect(loader.released).not.toContain("idle.webp")
    expect(loader.loads.filter((sheet) => sheet === "idle.webp")).toHaveLength(1)
  })

  it("never releases what's on screen, even while it stands in for a clip that won't load", async () => {
    const { loader, art } = await idleShowing()
    art.pick("sleep", "closed_day", 0)
    for (let now = 0; now <= 3 * KEEP_MS; now += 1000) art.pick("sleep", "closed_day", now)
    expect(loader.released).toEqual([])
    expect(art.pick("sleep", "closed_day", 3 * KEEP_MS)?.clip).toBe("idle")
  })

  it("releases a sheet that finishes loading after nobody wants it any more", async () => {
    const { loader, art } = await idleShowing()
    art.pick("sleep", "closed_day", 0)
    art.pick("idle", "calm_day", KEEP_MS)
    expect(loader.released).toEqual([])
    await loader.finish("sleep.webp")
    expect(loader.released).toEqual(["sleep.webp"])
  })

  it("keeps showing the old clip when a sheet fails, and retries after RETRY_MS", async () => {
    const { loader, art } = await idleShowing()
    art.pick("eat", null, 0)
    await loader.fail("eat.webp")
    expect(art.pick("eat", null, RETRY_MS - 1)?.clip).toBe("idle")
    expect(loader.loads.filter((sheet) => sheet === "eat.webp")).toHaveLength(1)
    art.pick("eat", null, RETRY_MS)
    expect(loader.loads.filter((sheet) => sheet === "eat.webp")).toHaveLength(2)
    await loader.finish("eat.webp")
    expect(art.pick("eat", null, RETRY_MS + 1)?.clip).toBe("eat")
  })

  it("releases everything on dispose, including loads that finish later", async () => {
    const { loader, art } = await idleShowing()
    art.pick("sleep", "closed_day", 0)
    art.dispose()
    expect(loader.released.sort()).toEqual(["idle.webp", "idle_calm.webp"])
    await loader.finish("sleep.webp")
    expect(loader.released).toContain("sleep.webp")
    expect(art.pick("idle", "calm_day", 10)).toBeNull()
  })
})
