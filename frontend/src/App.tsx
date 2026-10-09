import { parsePreview } from "./nyx/preview"
import { parsePage } from "./rooms"
import { RemoteView } from "./views/RemoteView"
import { ScreenView } from "./views/ScreenView"

export function App() {
  const result = parsePage(location.search)
  // the dev-only ?activity, ?mood and ?phase (src/nyx/preview.ts)
  const preview = parsePreview(location.search, import.meta.env.DEV)

  if (!result.ok) return <p className="page-error">{result.message}</p>
  if (result.page.view === "remote") return <RemoteView />
  if (!preview.ok) return <p className="page-error">{preview.message}</p>
  return <ScreenView room={result.page.room} fps={result.page.fps} preview={preview.preview} />
}
