import express from "express"
import type { NyxResident } from "./nyxResident"
import { attachTransport } from "./transport"

export function startHub(nyx: NyxResident, port: number) {
  const app = express()

  app.get("/health", (_req, res) => {
    res.json({ ok: true })
  })

  const server = app.listen(port)
  const transport = attachTransport(nyx, server)

  return {
    server,
    close() {
      transport.close()
      server.close()
    },
  }
}