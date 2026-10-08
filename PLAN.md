# Hub: plan and decisions

One home "space" made of screens: the TV, the projector, three laptop monitors, and the M5Stick's tiny screen. A **hub** on athena (the Raspberry Pi) runs it. The first resident is a small pet that lives in the hub, wanders across the screens, rides in your pocket on the stick, and jumps between them. Flick the stick and it lands on the TV.

The same screens also carry HUD widgets (lamp, system stats, uptime, ...) fed by the same hub.

This file is the source of truth for the design. When a decision changes, update it here and say why.

Naming: **"the hub"** is this project's server. **"The lamp hub"** is the server in the `ilamp` repo.

---

## 1. The pieces

```
athena (Raspberry Pi 5 behind the TV, always on)
├─ hub container (Node/TS): owns the pet + the world, reads sources, WebSocket pub/sub;
│    casts the screen page to the projector over WiFi (Google Cast, D12)
├─ Chromium kiosk (on the host, not a container): HDMI -> TV
├─ HDMI-CEC: TV on/off from code
└─ other stacks (separate repos/compose): lamp hub, Uptime Kuma, Prometheus later
                     ▲
          WebSocket (topics: nyx, world, lamp, metrics, ...)
                     │
     ┌───────────────┼─────────────────────┐
 TV + projector     laptop overlay          M5StickS3
 (screen page)      (Electron, 3 monitors)  (firmware)
```

| Piece | Runs on | Role |
|---|---|---|
| **hub** | athena, Docker | Owns the pet and the world. Reads other sources. Pushes topics to screens. Decides handoffs. |
| **screen** | Chromium kiosk on athena (TV), our Cast receiver on the projector itself (D12), Electron (laptop) | Draws its part of the world and its HUD widgets. No on-screen controls (M2.5). Never decides anything. |
| **remote** | a phone browser (the frontend at `?view=remote`) | Shows the pet's state as text and sends actions. Input comes from here, the stick, or later a gamepad. |
| **stick** | M5StickS3 | A screen while home; the pet's owner while carried (D2). Detects the flick (IMU). |
| **lamp** | the i_Lamp, via the lamp hub (`ilamp` repo) | A source the hub talks to over WebSocket. Never imported. |

**Room layout** (all on one wall):

```
              [ projector ]
[ TV ] [ mon 1 ] [ mon 2 ] [ mon 3 ]
```

The TV is directly left of monitor 1. The projector projects onto the wall above the monitors (placement in section 6). The TV is driven by the Pi's HDMI; the projector is wireless and runs the screen page itself through Google Cast (D12). Neither depends on the laptop, whose outputs are full. In the world, the TV is the room **Helios** and the projector is **Selene** (D10).

---

## 2. Decisions

Each one in short ADR form: what, why, what we gave up.

### D1: TypeScript/Node for the hub and the screens

- **Why:** Oz's strongest language. One language across the whole web side. Message types are defined once in `shared/` and type-checked on both ends.
- **Workers can be anything** (D9): a heavy task can run in Python or another language, as long as it speaks the protocol.
- **Gave up:** reusing Python code from the lamp project directly. We don't need to: the lamp is reached through its hub over WebSocket.

### D2: One owner at a time; ownership can travel

The pet exists in exactly one place. That's what makes "it jumped onto the TV" feel real.

- **At home** (on any home screen, or idle), the **hub** owns it. Its life keeps ticking even when nobody is watching.
- **In the pocket**, the **stick** owns it, so it works away from WiFi. When the stick returns, it hands the pet back, and the hub reconciles.
- **Screens never own the pet.** They render what the hub says.
- **Gave up:** simplicity. A hub-only design would be easier, but the pet couldn't leave the house.

### D3: Handoffs are a persisted transfer with one commit point and a recovery rule

**The invariant:** at any moment, at most one device *runs* the pet, and the pet is never lost. Every rule below exists to keep that true when messages get lost or a device restarts mid-transfer.

**The hub is always the coordinator**, in both directions (home -> stick and stick -> home). **The commit point is the hub writing `status=committed` to disk.** Before that moment the transfer can still be aborted; after it, it can only be completed.

**The transfer record**, persisted on the hub *and* on the stick before any message about it is sent:

```
{ id, direction: "to_stick" | "to_home", status: "offered" | "committed" | "aborted",
  snapshot, eventLog?, createdAt }
```

**Home -> stick (a throw to the pocket):**
1. Hub: persists the transfer as `offered` with a snapshot of the pet. **Stops running the pet** (it's frozen, `in_transit`). Sends `offer(id, snapshot)`.
2. Stick: persists the pending transfer, sends `accept(id)`. **Does not run the pet yet.**
3. Hub: on `accept`, persists `committed` and `owner=stick`. Sends `commit(id)`.
4. Stick: on `commit`, persists it, and **only now starts running the pet**, from the snapshot.

**Stick -> home (the flick, or coming back into WiFi range):** the stick sends `offer(id, snapshot, eventLog)` (see D5), freezes the pet, and keeps its local copy. The hub persists the transfer, replays the event log, persists `committed` + `owner=hub`, sends `commit(id)`, and starts running the pet. The stick deletes its local copy **only after receiving `commit`**.

**Recovery: every message can be retried, and either side can ask:**
- **Everything is idempotent by transfer id.** A repeated `offer` or `accept` gets the same answer it got the first time. A late message for an `aborted` transfer gets `abort(id)` back.
- **`status(id)`:** either side can ask "what happened to transfer X?" and get `offered`, `committed`, or `aborted`. The hub's answer is final.
- **Lost `commit`** (the case that motivated this): the stick sits with a pending transfer, so it **retries `accept(id)` / asks `status(id)`** until it gets an answer. The hub, already committed, just sends `commit(id)` again. Meanwhile the pet is frozen; nobody runs it twice.
- **Lost `offer` or `accept`:** the hub never reaches the commit point. After a timeout it persists `aborted`, and the pet resumes at its sender. If the stick later sends `accept` for it, the answer is `abort`.
- **Hub restart:** on boot it reads its transfer records. `offered` with no accept -> `aborted` (the pet resumes at the sender). `committed` -> the new owner stands, and the hub waits for the stick to ask.
- **Stick restart:** it reads its pending transfer from flash and asks `status(id)` on reconnect before doing anything else.

**Time isn't lost while frozen.** The receiver starts the pet from the snapshot and applies the elapsed time since it was taken, so a transfer that takes a while (retries, a restart) doesn't skip or double-count decay.

**Gave up:** a "fire and forget" handoff. This is more states and more tests, but it's the only version that actually keeps the promise.

### D4: The pet's core is pure logic with an injected clock

`core/` holds the pet's state and rules: stats, decay, actions, moods. No timers, no network, no rendering inside it. Time is **passed in** (`tick(state, now)`), never read from the system clock.

- **Why:** tests can fast-forward days in milliseconds ("leave it alone for 8 hours, is it hungry?"), and it's deterministic. Same lesson as `ilamp`'s protocol layer and fake lamp.
- **`core/` never knows screens exist.** *What* the pet is lives in `core/`; *where* it is on the home screens lives in `world/` (D10). This keeps the world design free to change without touching the pet's rules.
- The **stick firmware** reimplements a *simplified* version of these rules for offline time, and the hub reconciles when the pet comes home (D5).

### D5: The stick keeps an event log; the hub replays it

When the pet comes home, the stick doesn't send its final stats. It sends **what happened**: the snapshot the pet left with, plus an ordered list of actions with elapsed times:

```json
{
  "snapshot": { "...": "the pet's state at the moment it left home (from the commit)" },
  "events": [
    { "at_ms": 1200000, "action": "feed" },
    { "at_ms": 2100000, "action": "play" }
  ],
  "away_ms": 3600000
}
```

That reads as: left home, fed 20 minutes later, played at 35 minutes, came back after an hour. The hub replays it with its own `core` rules: tick to 20 minutes, apply `feed`, tick to 35 minutes, apply `play`, tick to 60 minutes. The result is the pet's real state.

- **Why not just the final numbers:** they lose the information needed to reconstruct the hour, and they risk applying time decay **twice** (once on the stick, once on the hub).
- **The hub's rules are the authority.** The stick's simplified simulation only gives **immediate feedback** while you're away (eating, looking sleepy) and is thrown away on return.
- **Elapsed times, not wall-clock timestamps**, so the stick's clock and the hub's don't need to agree.

**Measuring time on the stick (answered Oct 2026): the StickS3 has no RTC chip** (the StickC Plus2 had a BM8563; the S3 dropped it).
- **Deep sleep is fine:** the ESP32-S3's internal RTC timer keeps counting through deep sleep, and its 16 KB of RTC memory survives it. The elapsed-time counter can live there. *To verify in the stick spike.*
- **Full power-off or a dead battery is not:** with no RTC, the stick can't know how long it was off. Persisting a counter to flash only saves the time *before* it died.
- **Hypothesis (test in M3):** the hub measures `away_ms` itself, on its own clock, from the `commit` to the stick's return `offer`. The stick then only owns the *relative* timing of events. A power-off mid-carry makes event times after it uncertain, but the total stays correct, and only one clock (the hub's) is ever used for the total.

### D6: JSON messages over WebSocket, typed in one place, organized by topic

All messages are `{ "type": "...", ...fields }`. The types and validation schemas live in `shared/` and are imported by the hub and the screens. The ESP32 parses the same JSON (ArduinoJson). The hub **validates every incoming message** (zod, D13) before acting: nothing unvalidated reaches the pet.

**Pub/sub by topic:** a client subscribes to the topics it needs (`nyx`, `world`, `lamp`, `metrics`, ...) and only receives those. The TV can take everything; the stick only takes `nyx`. Adding a feature means a new source and a new topic; clients that don't care are unaffected.

### D7: Persistence as a JSON file at first

The hub's resident state (the pet, transfer records, the world) is written to a JSON file on every meaningful change, **atomically**: write a temp file, then rename. SQLite only if history or stats need it later.

- **Async file APIs only** (`fs/promises`), never the `*Sync` versions (D9).
- **On athena, the file lives in a Docker volume**, and that volume is **included in `athena-backup`** (restic), like Vaultwarden's data.
- **Why:** one pet, small state, easy to inspect and back up.

### D8: Stick firmware: Arduino C++ via PlatformIO + M5Unified (decided Oct 2026)

Smoke test done: build, flash, display, buttons, serial and PSRAM all work.

**Config** (`stick/platformio.ini`):
- `platform`: **pioarduino** (Arduino-ESP32 3.x core). The official PlatformIO platform is stuck on the 2.x core, and newer M5Stack hardware targets 3.x.
- `board = esp32-s3-devkitc-1`. There's no reliable dedicated StickS3 entry; same chip, and M5Unified detects the actual hardware at runtime.
- `board_build.arduino.memory_type = qio_opi` + `-DBOARD_HAS_PSRAM`: quad flash, **octal** PSRAM.
- `-DARDUINO_USB_CDC_ON_BOOT=1`: routes `Serial` over the native USB port.
- `lib_deps = m5stack/M5Unified`.

**Gotchas we hit (each one cost time):**
- **The PSRAM is octal, not quad.** Third-party spec listings say "QSPI PSRAM"; with `qio_qspi` the chip logs `quad_psram: PSRAM chip is not connected, or wrong PSRAM`. `qio_opi` works: confirmed `ESP.getPsramSize()` = 8388608 bytes. Lesson: spec listings are hypotheses; the chip is the authority.
- **`Serial.begin()` is required.** M5Unified does not call it in this setup. Without it, `Serial` silently drops everything.
- **Boot prints race the monitor.** Native USB disconnects and reconnects on every reset, so prints in `setup()` happen before the monitor reattaches. `while (!Serial)` does not help on this chip (it's true as soon as the USB link is up). Use a short `delay()` in development, or print on demand (button, timer).
- **First flash over the factory firmware needs manual download mode:** hold the side button ~2 s until the green LED blinks. After flashing, if the screen stays black, tap reset once (it can stay in the bootloader).
- **Only one program can hold the COM port.** Close the monitor before uploading, or use Upload and Monitor. "Access is denied" means the port is busy. The port number changes between bootloader and firmware (COM3/COM4); PlatformIO auto-detects it.

- **Why C++:** the best-supported route for M5Stack hardware, the most examples, and Oz wants to learn C++ through it.
- **Gave up:** MicroPython/UIFlow's quicker iteration (slower redraws, fewer examples, a third language); JavaScript on-device via Moddable (thin StickS3 support).

### D9: The hub is an orchestrator

One Node process (one container) on athena. Screens talk only to the hub, never to the lamp, Prometheus, or anything else directly.

**Two kinds of modules inside it:**
- **Residents:** things the hub **owns**: state + logic + persistence. Losing them loses data. Today: `pet`, `world`.
- **Sources:** adapters the hub **reads**. Stateless and replaceable; on restart they just re-read. Today and soon: `lamp` (WebSocket client to the lamp hub), `kuma` (Uptime Kuma), `metrics` (Prometheus, later).

**Rules:**
- **The hub only does small, bounded work per event.** Anything that can take long, or grows with input size, goes to a worker. The pet stays in the hub: its work is tiny, and the owner of the D3 invariant must not sit behind another network hop.
- **`async` does not mean non-blocking.** `await` on synchronous work still blocks the one thread. No `*Sync` file APIs; watch out for `JSON.parse` on huge payloads and regexes on huge strings.
- **Every request to a source or worker has a timeout.** "No answer" is a normal state (`unavailable` on that topic), never a hang.
- **Sources are isolated:** each adapter catches its own errors. A dead Prometheus means the `metrics` topic says `unavailable`; the pet keeps ticking.
- **Offload by need:** `worker_threads` for trusted CPU-heavy JS; a separate container for anything flaky, experimental, or needing crash isolation; any language for the worker (Python for audio/ML). The hub only speaks the protocol.
- **Split by evidence:** measure event-loop delay (`perf_hooks.monitorEventLoopDelay`) and expose it as a metric (and a HUD panel). If it creeps past a few milliseconds, something is blocking; move *that* thing out.

- **Rejected:** a separate pet server and HUD server (more processes that would have to talk to each other anyway); a different language with built-in threads (loses TypeScript and the shared types for a problem we don't have).
- **Gave up:** the crash isolation of one service per concern, for now. The `sources/` layout keeps splitting cheap later.

### D10: The world is a graph of rooms (leaning; finalize in M5)

- **Each screen is a room.** Rooms connect by **edges** (adjacent screens, which should feel continuous: Helios <-> mon 1 <-> mon 2 <-> mon 3) and **doors** (non-adjacent: the monitors up to Selene).
- **Room ids for the big screens:** the projector is **Selene** (moon goddess: the moon reflects light, and a projected image is light reflected off the wall). The TV is **Helios** (sun god: a screen that emits its own light). Siblings in the myths. "Projector" and "TV" still mean the hardware.
- **Screens come and go** (the laptop sleeps, the projector is off). Rooms are present or absent. The pet only enters present rooms; if its room disappears, the world moves it to a sensible present room.
- **The hub sends movement intents, not positions:** "walking from A to B, started at hub time T, speed S". Each screen computes the position for every frame. Traffic stays tiny and the animation smooth. Needs a rough clock sync between screens and the hub (a ping exchange).
- **The stick is a room while home and the owner while carried.** The D3 handoffs are the border between those two roles.
- **Two layers per screen:** a **world layer** (things that travel, like the pet) and a **HUD layer** (widgets fixed to that screen, like a clock). The pet may *interact* with widgets later; they stay different kinds of things.
- **Rejected:** one continuous coordinate plane (handles "screen is gone" badly, and the projector isn't really "next to" anything); streaming positions every frame (traffic and jitter on five screens).
- **Open:** the exact edge/door rules, and how the pet chooses where to go.

### D11: Repo boundaries

- **`hub` (this repo):** everything that speaks the hub's protocol: the hub server, the screens, the stick firmware, the shared types. One protocol change = one commit across both ends.
- **`athena`** (private): infra only. Deploys the hub as a Compose stack (built from this repo at a tag), the kiosk config, backups. It never contains hub code.
- **`ilamp`:** stays separate. The hub talks to the lamp hub over WebSocket.
- **Rejected:** hub code inside athena (every app commit becomes a deploy commit, and athena stops being a clean runbook); a separate HUD repo (the shared protocol would drift between repos, with no team boundary to justify it).

### D12: Selene runs the screen page itself, through our own Cast receiver

The projector is wireless, so nothing on athena renders for it. It's a Google TV with Google Cast built in (section 6), and athena can tell it what to show.

- **Tested:** from athena, `catt -d 192.168.1.167 ...` works. athena can launch Cast receivers on the projector.
- **Tested, fails:** `catt cast_site` (the generic DashCast receiver). It "force loads" by navigating away from the receiver page, and Google TV ends the session and returns to the home screen.
- **Plan:** our own registered Cast receiver app (Google Cast developer console, one-time $5; the projector is registered as a test device, so nothing is published). The receiver page is the frontend's screen view at `?room=selene` (or a thin shell around it) with the idle timeout disabled. The hub re-casts automatically when the Selene room disconnects (it already tracks screen presence, D10). Build it in M2/M4, once a page exists.
- **Requirements:** the receiver URL must be HTTPS and reachable from the projector (DNS is an open question, section 8). Cast discovery (mDNS) is blocked by ufw and doesn't cross into Docker, so the projector is addressed by IP.
- **Fallback:** a kiosk browser app on the projector (e.g. Fully Kiosk Browser) pointed at the page, auto-launching on boot.
- **Rejected:** an HDMI cable from the Pi (Oz doesn't want the projector cabled); the laptop driving it (its outputs are full).
- **Open risk:** the projector's chip renders the page, not the Pi (the TV's own browser managed ~12fps). Test the frame rate in M2.

### D13: Protocol and transport: zod schemas in `shared/`, full snapshots, the `ws` package

- **zod schemas, TS types derived with `z.infer`**, so the schema and the type can't disagree.
- **First messages** (each `{ type, ...fields }`, D6): screen -> hub `hello { room, topics }`, `act { action }`; hub -> screen `nyx { state, mood }`, `error { reason }`.
- **Full snapshots, not diffs:** `nyx` goes out on subscribe and on every change. The state is tiny, and a reconnect is trivial: the next snapshot is the whole truth.
- **Transport: the `ws` package.** Node 24 has a built-in WebSocket client but no server.
- **An invalid message gets `error` back, never a crash** (validation itself is D6).
- **Rejected:** Socket.IO. It runs its own protocol on top of WebSocket, which would make the ESP32 client in M6 much harder.

---

## 3. The pet itself (first version)

Keep it small; it can grow later.

- **Stats** (0-100): `hunger`, `energy`, `happiness`. They drift over time: hunger rises, energy falls while awake and recovers while sleeping, happiness follows the other two.
- **Three independent dimensions, not one state.** A pet can be happy *while* sleeping, so these never share a field:
  - **Mood** (derived from the stats): `happy`, `content`, `sad`, `grumpy`.
  - **Activity** (what it's doing): `idle`, `sleeping`, `eating`, `playing`.
  - **Presence** (who owns it, from the transfer records in D3): `home`, `stick`, `in_transit`.
- **Where it is on the home screens** is not part of the pet. That's the world's job (D10).
- **Movement belongs to the world too:** walking is a world movement intent (D10), not an activity, and arrives in M5.
- **Animation picks by activity, with mood as a modifier:** a sleeping animation with a smile, a walk that droops when sad. Presence and the world decide *which screen* draws it.
- **Actions** (from any client): `feed`, `play`, `pet`, `wake`.
- **Rules are data where possible** (rates and thresholds in one config), so tuning doesn't mean hunting through code.

Out of scope for v1: evolution, multiple pets, accounts, the internet.

---

## 4. Repo layout (npm workspaces + one PlatformIO project)

```
hub/
  shared/      protocol: message types, zod schemas, topics (hub + screens)
  core/        pet state + rules; pure; injected clock; heavily tested
  world/       the space: rooms, edges, doors, presence, intents; pure; tested
  server/      the hub process: residents (pet, world), sources (lamp, kuma, ...), WebSocket transport
  frontend/    ONE web app (React + TS + canvas, Vite): screen views + the remote (M2.5)
    src/
      main.tsx         mounts <App /> in StrictMode
      App.tsx          picks the view from the URL
      rooms.ts         room presets + the pure URL parser (tested in rooms.test.ts)
      theme.ts         reads the CSS palette for the canvas
      styles.css       the palette (CSS variables) + all styles
      hub/             connection.ts (WebSocket + reconnect), useHub.ts (the React hook)
      nyx/             draw.ts (pure canvas drawing), NyxCanvas.tsx
      debug/           fpsMeter.ts
      views/           ScreenView.tsx, RemoteView.tsx
  hud/         HUD widgets the screen views mount
  desktop/     Electron transparent overlay for the laptop monitors; loads frontend/ (later)
  stick/       ESP32 firmware (PlatformIO + M5Unified)
  tools/       fake stick, fake screens, simulators, asset helpers
  assets/      sprites (see section 7)
  docs/adr/    decisions that outgrow this file
  hub.code-workspace
```

- The server package is `server/`, not `hub/`, to avoid `hub/hub/`.
- **Open `hub.code-workspace` in VS Code, not the folder.** PlatformIO only activates when `platformio.ini` sits at the root of a workspace folder, so `stick/` is its own workspace folder alongside the repo root.
- Packages are added when their milestone starts; empty folders aren't committed.
- **frontend URLs:** `/?room=<id>` is a screen (`dev`, `helios`, `selene`; default `dev`), `&fps` adds a debug overlay; `/?view=remote` is the remote. An unknown room is an on-screen error, never a silent fallback.

Tests: **Vitest** for `core`, `world`, `shared`, and `server`. The server is tested against a **fake stick**, **fake screens** and a **fake clock**, like the fake lamp.

---

## 5. Milestones

Each one ends with something visibly working, and a commit.

### M1: The pet's brain (no hardware, no UI)
- `core`: state, rules, actions, injected clock.
- Tests that fast-forward time ("8 hours alone -> hungry, low mood").
- **Done when:** the tests pass, and a CLI script prints the pet's state over a simulated day.
- **Status: done (Oct 2026).** core: state, config, tick (whole steps, call-rhythm independent), actions (eating blocks, wake grace), derived mood. tools: one-day simulation CLI.

### M2: The pet on a screen (laptop browser)
- `shared/`: the zod schemas and `z.infer` types for the first messages (D13).
- `server/`: the hub process. Nyx is the first resident, with an injected `clock` (a `now()` function) and `store` (load/save). Tests use a fake clock and an in-memory store; production uses `Date.now` and a JSON file.
  - **Boot:** load `data/nyx.json`, or `createNyx(now)` if there's none, then tick to now (catch-up for the time the hub was down).
  - **Running:** a timer ticks every `stepMs`. Persist + broadcast only when the result `!==` the old state (`tick` returns the same object when no step has passed).
  - **Actions go through `act()`.** Persistence per D7 (temp file + rename, async only).
- **Transport:** `ws` (D13). Every incoming message is validated before anything acts on it; invalid -> `error`, never a crash.
- `screen/`: Vite + TS + canvas. In dev, Vite serves the page, which connects to `ws://localhost:8080`. Later the hub serves the built page itself: one origin, one HTTPS cert, which also suits the Cast receiver (D12). Shows the stats; buttons send `act`; re-renders on every `nyx` snapshot.
- **Placeholder art:** Nyx as a glowing orb drawn with canvas shapes, with a moon phase showing mood. Idle = slow float, sleeping = dim + drifting z's, eating/playing = a pulse.
- **Walking moves to M5.** `core` has no walking, and with one screen there's nowhere to walk.
- **Check the frame rate on the projector** once the page exists (D12's open risk).
- **Build order, each step committed:**
  1. `shared` schemas + tests.
  2. `server` resident with a fake clock and store + tests, including a restart.
  3. `ws` transport + validation + a poke script.
  4. The `screen` page.
  5. The done-when check, for real.
- **Done when:** the pet lives in a laptop browser tab, keeps living across a hub restart, and buttons affect it.
- **Status: done (Oct 2026).** Nyx lives in the hub (ticking, persisted to JSON, survives restarts), with a WebSocket transport (zod-validated, broadcast to all subscribers) on an Express server, plus a Vite screen page: a glowing orb with a moon for mood, live updates, action buttons, auto-reconnect. Tested on Selene through a browser app over the LAN: 57-59 fps (60 Hz output) idle and during the play pulse; with room lights on, the dark background nearly vanishes into the wall, confirming the light-on-dark design.

### M2.5: Frontend foundation
The M2 `screen/` page was a working proof of concept: one `main.ts` with all the wiring, CSS inline in `index.html`, and the action buttons on the same page as the display, although Helios and Selene have no input. Before M3-M5 add more to it, it's restructured:
- **One app:** `screen/` becomes `frontend/`, a React app (React, `@vitejs/plugin-react`; no router, no state library, no CSS framework). The URL picks the view.
- **Screens only show.** `ScreenView` is a fullscreen canvas and nothing else; a small debug overlay (connection status + fps) appears only with `?fps`.
- **The remote controls.** `RemoteView` (`?view=remote`, meant for a phone) shows status, activity, mood and stats, with one large button per action, generated from `ACTIONS` so a new action appears automatically.
- **Rooms are configuration, not code.** Per-room differences (today: a glow multiplier; Selene fights room light, so it glows brighter than Helios) are presets in `rooms.ts`, never branches inside components.
- **One palette:** colors live as CSS variables in `styles.css`; `theme.ts` reads them for the canvas, so CSS and canvas can't disagree (the moon's shadow circle must be exactly the background).
- **Lifecycle-safe:** the WebSocket and the animation loop live in React effects with cleanups (`close()`, `cancelAnimationFrame`, `ResizeObserver.disconnect`), so StrictMode's double mount in development doesn't leave a second socket or loop behind.
- **Done when:** the screen works on the laptop at `?room=dev&fps`, the remote on a phone, a feed from the phone shows on the screen, both reconnect after a hub restart, and Selene at `?room=selene&fps` still runs at 57-60 fps.
- **Status (Oct 2026): all working except the fps.** **Revisit:** Selene averages ~53 fps (M2: 57-59). Test one variable at a time: the glow (`dev` vs `selene` room), a production build vs dev, the old M2 page re-measured today, then the canvas size (fullscreen now, 70vh in M2; main suspect, since the orb and halo scale with height).

### M3: Handoffs with a fake stick
- `tools/fake-stick`: a script that connects as the stick and can "flick," "carry" (record events), and "return."
- The D3 transfer protocol end to end, with persisted transfer records on both sides; the screen animates leaving and arriving.
- The D5 event log: carry the pet, feed and play it, return it, and check the hub's replay. Test the hypothesis that the hub measures `away_ms` itself.
- **Tests, one per failure, in both directions:**
  - lost `offer`, lost `accept`, **lost `commit`**;
  - hub restart after `offered` and after `committed`;
  - stick restart while a transfer is pending;
  - duplicate and late messages (a repeated `accept`, an `accept` arriving after an abort);
  - a return after a long time away, checking decay is applied once and only once.
- **One test that checks the invariant directly:** run many transfers with randomly dropped messages and random restarts, and assert after every step that at most one side runs the pet and that it always ends up somewhere.
- **Done when:** all of the above pass. "Never duplicates or vanishes" is a claim the tests prove, not a hope.

### M4: The hub on athena
- athena already runs (Pi OS Lite, Docker + Compose, Caddy). In the **athena repo**: a `hub` stack (one container, a volume for resident state, on the internal Docker network), behind Caddy as `hub.domer.dev` (LAN/Tailscale only, like the other services).
- Add the hub's state volume to `athena-backup`.
- Kiosk on the host: Chromium fullscreen on the HDMI output to the TV, loading the frontend at `?room=helios`. The kiosk only drives the TV.
- Selene: the hub launches our Cast receiver on the projector by IP and re-casts when the room drops (D12). Needs the page on HTTPS under a name the projector can resolve (section 8).
- HDMI-CEC: the TV turns on when the pet wakes, and off at night.
- **Done when:** unplug athena, plug it back in, and the pet is back on Helios and Selene without touching anything, with its state intact.

### M5: The world (many screens)
- `world/`: rooms, edges, doors, presence, movement intents (D10). Pure, tested with fake screens joining and leaving.
- Clock sync between screens and the hub.
- The pet walks between Helios, Selene and a laptop browser window (walking, including its animation, moved here from M2).
- **Done when:** the pet walks across screens, survives a screen turning off mid-walk, and looks consistent on every screen.

### M6: The real stick
- Firmware: WiFi + WebSocket client, the pet on the tiny screen, buttons for actions.
- At home, the stick is a room (D10). The IMU flick gesture -> throw request.
- Offline mode: simplified rules for immediate feedback while away, an event log of everything that happens, and replay by the hub on return (D5). Transfer records persisted to flash (D3).
- WiFi credentials in `stick/include/secrets.h` (gitignored), with a committed `secrets.example.h`.
- **Done when:** flick the stick and the pet lands on the TV; walk out of WiFi range and it keeps living on the stick; come back and it syncs.

### M7: Extras (each one independent and small)
- **The lamp:** the lamp glows with the pet's mood.
- **HUD panels:** system metrics (CPU temperature, the hub's event-loop delay), Uptime Kuma status.
- **DualShock:** play with the pet on the TV (Gamepad API in the kiosk; pair the DS4 with the Pi).
- **Claps:** the clap detector wakes the pet up (likely a separate worker, D9).
- **The laptop overlay** (Electron, transparent, click-through, across the 3 monitors): the pet walks on the actual desktop.

### Parallel: the stick spike (alongside M1-M4)
Small firmware experiments that teach C++ and answer open questions, without building M6 early:
- **Face + blink with `millis()`:** the drawing API, non-blocking timing, and the section 7 check: does the pet still read at 240x135?
- **IMU logger:** stream accelerometer values over serial while flicking the stick; look at the numbers before picking thresholds (section 8).
- **Deep-sleep time test:** confirm an elapsed-time counter in RTC memory survives deep sleep (D5).

---

## 6. Hardware notes

- **athena:** Raspberry Pi 5 4GB, Raspberry Pi OS Lite (Trixie), headless over SSH, Docker + Compose, Caddy (`*.domer.dev`, LAN/Tailscale only). Boot from NVMe planned (M.2 HAT+ on the way). LAN IP 192.168.1.165. **One micro-HDMI output -> the TV**; the projector is wireless (D12). Pi OS Lite has no desktop, so the kiosk needs a minimal compositor (see open questions).
- **athena's network:** currently on WiFi (`wlan0`), sitting on the desk. Ping to the projector (both on WiFi) is ~50-75 ms. Wire it via the in-wall Ethernet when it moves behind the TV. Not urgent: the D10 intents design already tolerates latency.
- **TV (Helios):** Samsung UA40J5200 (2015), directly left of monitor 1. Its own browser managed ~12fps, so we don't render on it; the Pi's Chromium does.
- **Projector (Selene):** Aurzen EAZZE D1 Max, projecting onto the wall above the monitors. Google TV 14 (Android TV 14), Google Cast built in, native 1920x1080, MediaTek MT9676 (quad Cortex-A55, 1.5 GHz), Mali-G52 MP2, 2 GB RAM, 1000 ANSI lumens. Wireless: it runs the screen page itself (D12). Set its Cast device name to "Selene".
  - **Clearly visible with the room lights on, but it can't project black** (black = the wall's color). Design Nyx as a light source on a dark page.
  - **Network:** LAN IP 192.168.1.167, DHCP-reserved on the router with its real MAC. Android MAC randomization is turned off for this network (a randomized MAC can rotate and silently break the reservation).
  - **Placement:** currently on the bed, propped on books, firing at an angle, which causes heavy keystone. Plan: a tripod/light stand or a small shelf square across from the image center, with minimal digital keystone (it resamples the image, which blurs small text and pixel art). Final spot TBD.
- **Laptop:** three monitors; its outputs are full, so it can't drive the projector either.
- **M5StickS3:** ESP32-S3-PICO-1-N8R8 (dual-core 240 MHz, 8 MB flash, **8 MB octal PSRAM**), 1.14" 240x135 IPS (ST7789P3), BMI270 6-axis IMU, ES8311 codec + mic + 1 W speaker, IR TX/RX, 250 mAh battery, two user buttons (G11, G12), **no RTC chip**. Flashing gotchas in D8.
- **Pi Bluetooth** may serve the lamp hub (BLE) *and* a DualShock (classic) at once. That usually works, but verify it.
- **The lamp** must be within BLE range of the Pi if the lamp hub moves there.

---

## 7. Assets (sprites)

Plan: generate a base character with an image model (ChatGPT / Gemini), then clean it up by hand.

What to expect and how to keep it usable:
- **Image models are bad at consistent animation frames.** The character drifts between frames. So generate the **character design** and maybe a few key poses, then draw or fix the animation frames by hand in **Piskel** (free, browser) or **Aseprite**.
- **Pick a fixed grid first:** e.g. 32x32 or 48x48 per frame. Everything snaps to it.
- **Transparent background, a limited palette,** and nearest-neighbor scaling (no blur) when drawing on canvas.
- **One sprite sheet per activity** (idle, walk, sleep, eat, play, jump/leave), with frame size and count recorded in a small JSON next to it. **Mood is a variant, not an animation:** start with a different face per mood layered on top, so you don't draw every activity x mood combination.
- The stick's screen is 240x135: check early (stick spike) that the sprite still reads at that size.
- Check the image tool's terms on using its output in a public repo.

---

## 8. Open questions

- The pet's look. Name resolved: **Nyx** (goddess of night; Greek naming alongside athena). **to be decided if** night is a design theme, not just a name: sleep is her element (possibly more active after dark), dark palette with a glow, a moon as the mood indicator, the lamp as her night-light. Decide specifics in M2.
- The stick's offline rules: how simple can they be and still feel right?
- What the flick gesture is exactly (a sharp acceleration spike past a threshold? a direction?). Tune with real IMU data from the stick spike's logger: record, look at the numbers, then set thresholds.
- World details (D10): edge vs door rules, how the pet picks where to go, how far off the clock sync can be before it looks wrong.
- Kiosk on Pi OS Lite: which minimal compositor (e.g. cage or labwc) for one fullscreen Chromium on the TV.
- **DNS for Selene:** the projector uses the router's DNS, not AdGuard via Tailscale, so it can't resolve `*.domer.dev` (and D12 needs an HTTPS URL it can reach). Option: a Cloudflare record such as `nyx.domer.dev -> 192.168.1.165` (athena's LAN IP). It's unreachable from the internet, but it publishes that the name exists, which bends the "homelab names stay private" rule. Undecided.
- The projector's final spot (section 6).
- Public or private repo (sprite tool terms; secrets stay out either way).
- Exact stat rates (tune by feel in M2). First simulation: grumpy for long stretches (the 20-30 energy band before every sleep, plus hunger), several naps per day, and the wake/sleep cycle doesn't line up with a real day.
- Test on Selene: does a #05060a background read as "dark wall" with room lights on, or as gray? Decides how much the design leans on glow vs. contrast.
- **Clients vs rooms (decide in M5):** the protocol's `hello { room }` field currently identifies *any* client, not only world rooms: the remote says hello as `remote` and the poke script as `poke`, though neither is a room the pet can enter. Should a client and a room be separate concepts (e.g. `hello { client, room? }`)?

Resolved: **Docker or plain systemd on the Pi** -> the hub runs in Docker (athena is Compose-based); the kiosk runs on the host.
