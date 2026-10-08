import { ACTIONS } from "@hub/core/nyx"
import type { Stats } from "@hub/core/nyx"
import { statusText } from "../hub/connection"
import { useHub } from "../hub/useHub"

const STAT_HINTS: Record<keyof Stats, string> = {
  hunger: "0 full, 100 starving",
  energy: "0 exhausted, 100 rested",
  happiness: "0 miserable, 100 ecstatic",
}

export function RemoteView() {
  const { nyx, status, send } = useHub("remote")
  const connected = status.state === "connected"

  return (
    <main className="remote">
      <p className="remote-status">{statusText(status)}</p>

      {nyx ? (
        <section>
          <h1 className="remote-headline">{nyx.state.activity} / {nyx.mood}</h1>
          <dl className="remote-stats">
            {Object.entries(nyx.state.stats).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  {value.toFixed(0)}
                  <span className="remote-hint">{STAT_HINTS[name as keyof Stats]}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <p className="remote-headline">waiting for Nyx...</p>
      )}

      <nav className="remote-actions">
        {ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            disabled={!connected}
            onClick={() => send({ type: "act", action })}
          >
            {action}
          </button>
        ))}
      </nav>
    </main>
  )
}
