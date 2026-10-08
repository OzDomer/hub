import { parsePage } from "./rooms"
import { ScreenView } from "./views/ScreenView"

export function App() {
  const result = parsePage(location.search)

  if (!result.ok) return <p className="page-error">{result.message}</p>
  if (result.page.view === "remote") return <p className="page-error">the remote view arrives in step 4</p>
  return <ScreenView room={result.page.room} fps={result.page.fps} />
}
