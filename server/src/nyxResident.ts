import type { NyxState, Action } from "@hub/core/nyx"
import type { NyxConfig } from "@hub/core/config"
import { createNyx } from "@hub/core/nyx"
import { tick as tickNyx } from "@hub/core/tick"
import { act as actOnNyx } from "@hub/core/act"
import { defaultConfig } from "@hub/core/config"

export type Clock = () => number

export interface Store {
  load(): Promise<NyxState | null>
  save(state: NyxState): Promise<void>
}

export type Listener = (state: NyxState) => void

export interface NyxResident {
  current(): NyxState
  tick(): boolean
  act(action: Action): boolean
  onChange(listener: Listener): () => void
  flushed(): Promise<void>
}

export async function startNyx(
  store: Store,
  clock: Clock,
  config: NyxConfig = defaultConfig,
): Promise<NyxResident> {
  const loaded = await store.load()
  let nyx = loaded ?? createNyx(clock())
  const listeners = new Set<Listener>()
  let saving: Promise<void> = Promise.resolve()

  function save(state: NyxState): void {
    saving = saving
      .then(() => store.save(state))
      .catch((error) => console.error("failed to save nyx", error))
  }

  function update(next: NyxState): boolean {
    if (next === nyx) return false
    nyx = next
    save(next)
    for (const listener of listeners) listener(next)
    return true
  }

  if (loaded === null) save(nyx)
  update(tickNyx(nyx, clock(), config))

  return {
    current: () => nyx,
    tick: () => update(tickNyx(nyx, clock(), config)),
    act: (action) => update(actOnNyx(nyx, action, clock(), config)),
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    flushed: () => saving,
  }
}