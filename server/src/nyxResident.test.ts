import { describe, it, expect } from "vitest"
import type { NyxState } from "@hub/core/nyx"
import { HOUR, MINUTE } from "@hub/core/config"
import { startNyx } from "./nyxResident"
import type { Store } from "./nyxResident"

const T0 = 1000 * MINUTE

function memoryStore() {
  let saved: NyxState | null = null
  const store: Store = {
    load: async () => saved,
    save: async (state) => {
      saved = state
    },
  }
  return { store, saved: () => saved }
}

function fakeClock(start: number) {
  let now = start
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("startNyx", () => {
  it("creates and saves a new Nyx when nothing is stored", async () => {
    const { store, saved } = memoryStore()
    const nyx = await startNyx(store, fakeClock(T0).clock)
    await nyx.flushed()
    expect(saved()?.lastTickAt).toBe(T0)
  })

  it("catches up on time that passed while the hub was down", async () => {
    const { store } = memoryStore()
    const { clock, advance } = fakeClock(T0)

    const first = await startNyx(store, clock)
    await first.flushed()
    const hungerBefore = first.current().stats.hunger

    advance(8 * HOUR)
    const second = await startNyx(store, clock)

    expect(second.current().lastTickAt).toBe(T0 + 8 * HOUR)
    expect(second.current().stats.hunger).toBeGreaterThan(hungerBefore)
  })

  it("notifies listeners only when something changed", async () => {
    const { clock, advance } = fakeClock(T0)
    const nyx = await startNyx(memoryStore().store, clock)
    let calls = 0
    nyx.onChange(() => calls++)

    expect(nyx.tick()).toBe(false)
    expect(calls).toBe(0)

    advance(MINUTE)
    expect(nyx.tick()).toBe(true)
    expect(calls).toBe(1)
  })

  it("applies actions and saves the result", async () => {
    const { store, saved } = memoryStore()
    const nyx = await startNyx(store, fakeClock(T0).clock)

    expect(nyx.act("feed")).toBe(true)
    expect(nyx.current().activity).toBe("eating")
    await nyx.flushed()
    expect(saved()?.activity).toBe("eating")
  })

  it("writes saves in order, even when an earlier save is slow", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const writes: string[] = []
    let calls = 0
    const store: Store = {
      load: async () => null,
      save: async (state) => {
        calls++
        if (calls === 1) await gate
        writes.push(state.activity)
      },
    }

    const nyx = await startNyx(store, fakeClock(T0).clock)
    nyx.act("feed")
    release()
    await nyx.flushed()

    expect(writes).toEqual(["idle", "eating"])
  })
})