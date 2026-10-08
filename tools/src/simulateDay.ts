import type { NyxState, Action } from "@hub/core/nyx"
import { createNyx } from "@hub/core/nyx"
import { tick } from "@hub/core/tick"
import { act } from "@hub/core/act"
import { moodOf } from "@hub/core/mood"
import { HOUR, MINUTE } from "@hub/core/config"

const DAY = 24 * HOUR
const START_HOUR = 8

const events = new Map<number, Action>([
  [1 * HOUR, "feed"],
  [5 * HOUR, "play"],
  [5 * HOUR + 30 * MINUTE, "pet"],
  [9 * HOUR, "wake"],
  [12 * HOUR, "feed"],
])

function clock(offset: number): string {
  const totalMinutes = START_HOUR * 60 + offset / MINUTE
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function num(n: number): string {
  return n.toFixed(0).padStart(3)
}

function print(offset: number, nyx: NyxState, note: string): void {
  const { hunger, energy, happiness } = nyx.stats
  console.log(
    `${clock(offset)}  ${nyx.activity.padEnd(8)} ${moodOf(nyx).padEnd(7)}` +
    `  hunger ${num(hunger)}  energy ${num(energy)}  happy ${num(happiness)}  ${note}`,
  )
}

let nyx = createNyx(0)
print(0, nyx, "born")

for (let t = MINUTE; t <= DAY; t += MINUTE) {
  const before = nyx.activity
  nyx = tick(nyx, t)

  const action = events.get(t)
  if (action) {
    nyx = act(nyx, action, t)
    print(t, nyx, `<- ${action}`)
  } else if (nyx.activity !== before) {
    print(t, nyx, `-> ${nyx.activity}`)
  } else if (t % HOUR === 0) {
    print(t, nyx, "")
  }
}