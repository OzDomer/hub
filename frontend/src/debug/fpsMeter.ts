export function createFpsMeter(onReport: (report: string) => void) {
  let frames = 0
  let windowStart = 0
  let last = 0
  let slowest = 0

  return function count(time: number): void {
    if (last !== 0) slowest = Math.max(slowest, time - last)
    last = time
    frames++

    if (windowStart === 0) windowStart = time
    const elapsed = time - windowStart
    if (elapsed < 1000) return

    const fps = Math.round((frames * 1000) / elapsed)
    onReport(`${fps} fps, slowest frame ${slowest.toFixed(0)} ms`)
    frames = 0
    windowStart = time
    slowest = 0
  }
}