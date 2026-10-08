import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNyx } from "@hub/core/nyx"
import { fileStore } from "./fileStore"

let dir = ""

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hub-test-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("fileStore", () => {
  it("returns null when nothing has been saved", async () => {
    expect(await fileStore(join(dir, "nyx.json")).load()).toBeNull()
  })

  it("loads exactly what it saved", async () => {
    const store = fileStore(join(dir, "nyx.json"))
    const nyx = createNyx(1000)
    await store.save(nyx)
    expect(await store.load()).toEqual(nyx)
  })

  it("creates missing folders", async () => {
    const store = fileStore(join(dir, "data", "nyx.json"))
    await store.save(createNyx(1000))
    expect(await store.load()).not.toBeNull()
  })

  it("leaves no temp file behind", async () => {
    await fileStore(join(dir, "nyx.json")).save(createNyx(1000))
    expect(await readdir(dir)).toEqual(["nyx.json"])
  })

  it("refuses a corrupt file instead of starting over", async () => {
    const path = join(dir, "nyx.json")
    await writeFile(path, "{ not json")
    await expect(fileStore(path).load()).rejects.toThrow()
  })
})