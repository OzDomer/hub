import { join } from "node:path"
import { startNyx } from "./nyxResident"
import { fileStore } from "./fileStore"
import { startHub } from "./app"

const PORT = Number(process.env.PORT ?? 8080)
const DATA_DIR = process.env.DATA_DIR ?? "data"
const TICK_EVERY_MS = 5_000

const nyx = await startNyx(fileStore(join(DATA_DIR, "nyx.json")), Date.now)
const hub = startHub(nyx, PORT)
const timer = setInterval(nyx.tick, TICK_EVERY_MS)

hub.server.once("listening", () => {
  console.log(`hub on http://localhost:${PORT}, websocket on /ws`)
})

async function shutdown() {
  clearInterval(timer)
  hub.close()
  await nyx.flushed()
  process.exit(0)
}

process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())