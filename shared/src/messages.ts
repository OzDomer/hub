import { z } from "zod"
import { ACTIONS } from "@hub/core/nyx"
import type { NyxState } from "@hub/core/nyx"
import type { Mood } from "@hub/core/mood"

export const TOPICS = ["nyx"] as const
export type Topic = (typeof TOPICS)[number]

const helloSchema = z.object({
  type: z.literal("hello"),
  room: z.string().min(1).max(64),
  topics: z.array(z.enum(TOPICS)).min(1),
})

const actSchema = z.object({
  type: z.literal("act"),
  action: z.enum(ACTIONS),
})

const clientMessageSchema = z.discriminatedUnion("type", [helloSchema, actSchema])

export type ClientMessage = z.infer<typeof clientMessageSchema>

export type ServerMessage =
  | { type: "nyx", state: NyxState, mood: Mood }
  | { type: "error", reason: string }

export type ParseResult =
  | { ok: true, message: ClientMessage }
  | { ok: false, reason: string }

export function parseClientMessage(raw: string): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, reason: "not valid JSON" }
  }

  const result = clientMessageSchema.safeParse(json)
  if (!result.success) {
    return { ok: false, reason: z.prettifyError(result.error) }
  }
  return { ok: true, message: result.data }
}