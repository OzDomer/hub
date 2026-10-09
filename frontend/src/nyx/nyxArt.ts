import nyxDayUrl from "../assets/nyxDay.png"
import nyxNightUrl from "../assets/nyxNight.png"
import type { DayPhase } from "./dayPhase"

export type NyxArt = Record<DayPhase, HTMLImageElement>

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

export async function loadNyxArt(): Promise<NyxArt> {
  const [day, night] = await Promise.all([loadImage(nyxDayUrl), loadImage(nyxNightUrl)])
  return { day, night }
}
