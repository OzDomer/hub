import { describe, expect, it } from "vitest"
import { dayPhase } from "./dayPhase"

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 9, hour, minute)
}

describe("dayPhase", () => {
  it("is still day at 18:59", () => {
    expect(dayPhase(at(18, 59))).toBe("day")
  })

  it("turns night at 19:00", () => {
    expect(dayPhase(at(19, 0))).toBe("night")
  })

  it("is night across midnight", () => {
    expect(dayPhase(at(23, 59))).toBe("night")
    expect(dayPhase(at(0, 0))).toBe("night")
  })

  it("is still night at 06:59", () => {
    expect(dayPhase(at(6, 59))).toBe("night")
  })

  it("turns day at 07:00", () => {
    expect(dayPhase(at(7, 0))).toBe("day")
  })

  it("is day at noon", () => {
    expect(dayPhase(at(12, 0))).toBe("day")
  })
})
