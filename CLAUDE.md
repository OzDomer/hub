# CLAUDE.md

Read **PLAN.md** first. It's the source of truth for the design, the decisions (D1-D13), and the milestones (M1-M7, plus the parallel stick spike). When a decision changes, update PLAN.md and say why.

## How Oz likes to work

- He's learning (JS/TS course graduate; newer to embedded and Linux servers). **Go step by step and explain the why**, not just the what. Understanding matters more than speed.
- **The stick firmware is C++, and Oz is learning C++ through it.** Explain every new line of C++ in depth: what it does, why it's there, and how it compares to JS/TS.
- Show the design for a milestone before writing a lot of code, and get a go-ahead.
- Treat hypotheses as hypotheses. Test one variable at a time. When something turns out wrong, say so plainly.
- Blunt, direct technical talk. He pushes back when he disagrees, so take that seriously.
- Work milestone by milestone. Commit after each working step with a descriptive message.

## Conventions

- TypeScript everywhere on the web side, npm workspaces (see PLAN.md section 4).
- TS/JS without semicolons, formatted by hand. No Prettier.
- File names are camelCase (`simulateDay.ts`), never kebab-case. The one exception: React component files are PascalCase (`App.tsx`, `NyxCanvas.tsx`), the React convention.
- `core/` and `world/` are pure: no timers, no I/O, time is passed in. Test them heavily with Vitest.
- `core/` never references screens or positions on screens; that's `world/`'s job.
- Outside `core`, act on Nyx only through `act()` (it ticks first). `applyAction` is internal to `core` and not in its package exports.
- The hub server does only small, bounded work per event (PLAN.md D9): no `*Sync` file APIs, a timeout on every request to a source or worker, and every source catches its own errors.
- Every incoming WebSocket message is validated against the schemas in `shared/` before anything acts on it.
- Test against fakes (a fake stick, fake screens, a fake clock) before real hardware. Before calling a test suite done, break the code on purpose once and confirm a test fails.
- Secrets are never committed: `.env` and `stick/include/secrets.h` are gitignored. Commit an example file (`.env.example`, `secrets.example.h`) instead.
- Line endings are LF (`.gitattributes`); the code runs on Linux.
- No barrel files. Packages expose modules through explicit subpath exports in `package.json` (`@hub/core/math`); inside a package, use relative imports.
- Commits follow Conventional Commits: `type(scope): description`, with scope = package folder (`core`, `server`, `stick`, ...).
- Never amend a commit that's already pushed; make a follow-up commit.
- Destructive shell commands (`mv`, `rm`) are given one per line, never as a multi-line block.
- Tests live next to the code they test (`tick.ts` / `tick.test.ts`), not in a separate folder.
- `frontend/`: screens never have controls; they only show. Input comes from the remote (`?view=remote`), the stick, or later the DualShock.
- `frontend/`: per-room differences go in the `rooms.ts` presets, never in branches inside components (no `if (room.id === "selene")`).
- `frontend/`: every color is a CSS variable in `styles.css`; the canvas gets colors only through `theme.ts`.

## Environment

- Development: Windows, Git Bash, VS Code. **Open `hub.code-workspace`, not the folder:** PlatformIO only activates when `platformio.ini` is at the root of a workspace folder, so `stick/` is its own workspace folder.
- The hub runs on **athena** (Raspberry Pi 5, Raspberry Pi OS Lite, Docker + Compose, Caddy; LAN IP 192.168.1.165), deployed from the separate, infra-only **athena** repo (github.com/OzDomer/athena, private). This repo never contains deploy config; athena never contains hub code.
- The big screens (room ids in the world): the TV is **Helios** (athena's HDMI + Chromium kiosk); the projector is **Selene** (wireless Google TV at 192.168.1.167, shows the page via our Cast receiver, PLAN.md D12).
- The stick: M5StickS3 over USB. Flashing and serial gotchas (download mode, octal PSRAM, `Serial.begin`, busy COM port) are in PLAN.md D8.
- Related project: github.com/OzDomer/ilamp (the lamp hub). The hub talks to it over WebSocket and never imports `ilamp`. Naming: **"the hub"** is this project; **"the lamp hub"** is ilamp's server.
