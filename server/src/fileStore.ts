import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { NyxState } from "@hub/core/nyx"
import type { Store } from "./nyxResident"

export function fileStore(path: string): Store {
  return {
    async load() {
      try {
        const text = await readFile(path, "utf8")
        return JSON.parse(text) as NyxState
      } catch (error) {
        if (isMissingFile(error)) return null
        throw error
      }
    },

    async save(state) {
      await mkdir(dirname(path), { recursive: true })
      const temp = `${path}.tmp`
      await writeFile(temp, JSON.stringify(state, null, 2))
      await rename(temp, path)
    },
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}