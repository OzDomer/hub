import { parsePage } from "./rooms"
import { RemoteView } from "./views/RemoteView"
import { ScreenView } from "./views/ScreenView"

export function App() {
  const result = parsePage(location.search)

  if (!result.ok) return <p className="page-error">{result.message}</p>
  if (result.page.view === "remote") return <RemoteView />
  return <ScreenView room={result.page.room} fps={result.page.fps} />
}
