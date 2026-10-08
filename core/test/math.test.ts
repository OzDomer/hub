import { describe, it, expect } from "vitest"
import { clamp } from "../src/math"

describe("clamp", () => {
  it("keeps values inside the range", () => {
    expect(clamp(150, 0, 100)).toBe(100)
    expect(clamp(-5, 0, 100)).toBe(0)
    expect(clamp(42, 0, 100)).toBe(42)
  })
})