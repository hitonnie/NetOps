# NetOps: Office Network Engineer

A NOC / CCNA troubleshooting simulation game. Watch a software company's office from above, take incident reports, investigate with Cisco IOS-style, Windows and Linux commands, fix the root cause, and verify.

A PC game: play with a mouse and keyboard, in the browser or as an installed Windows app.

## Run in the browser
```
npm install
npm run dev      # http://localhost:5173
npm test         # 48 tests: engine, CLI, every scenario solvable, pacing, reproducibility
npm run build    # type-check + production build into dist/
```

## Desktop app (Windows)
```
npm run desktop   # build, then open the game in its own window (Electron)
npm run dist:win  # build the installer: release/NetOps-Setup-<version>.exe
npm run icons     # regenerate build/icon.ico + electron/icon.png from the logo
```
The installer asks where to install, then adds Start-menu and desktop shortcuts. It installs per user, so it doesn't need admin rights.
The desktop app runs the same `dist/` build as the web version, served from a private `app://` origin with no Node access in the page. **F11** toggles full screen.

**Autosave:** it's always on. In the desktop app the game writes `%APPDATA%\NetOps\saves\autosave.json` every 20 seconds and when you close the window, and keeps the previous save as `autosave.backup.json`. Settings → Save shows the path and has an **Open save folder** button. In the browser, progress is saved to the browser instead.

**Unsigned builds:** the installer isn't code-signed. SmartScreen may show "Windows protected your PC" (click **More info → Run anyway**). If **Smart App Control** is on (Windows 11), it blocks unsigned apps completely, and the only fix is a code-signing certificate, e.g. Azure Trusted Signing via electron-builder's `win.azureSignOptions`. To test the desktop shell without packaging, run `npx electron .`.

## Architecture
- `src/net/` – stateful network model and engine (L1 link/PoE → L2 VLANs/trunks/STP/MAC tables → L3 routing/ARP/ACL/NAT, DHCP, DNS, Wi-Fi), plus CLIs in `net/cli/` (IOS, Windows, Linux).
- `src/incidents/` – 30 scenarios (root cause, symptoms, checklist, outcome-based verification, hints, scripted solution used by tests) and the director (pacing, caps, cooldowns, escalation) in `sim/game.ts`.
- `src/world/` – office layout, roster, pathfinding, employee behaviour.
- `src/sim/` – `Game` orchestrator: clock, productivity, economy, inbox/tasks/manager, persistence (localStorage), deterministic sub-stepping.
- `src/render/` – procedural Canvas 2D renderer (no external assets). `src/ui/` – React panels.
- `src/components/ui/` – shadcn-style UI components (8-bit card, button, main menu and XP bar, plus `button-1`), styled with Tailwind 4 (`src/index.css`, `components.json`). The game's own stylesheet `src/styles.css` sits in a lower cascade layer.
- `src/content/` – manual/runbook, shop, message text.
- `electron/` – desktop shell (window, `app://` file server, security settings). Installer settings live under `build` in `package.json`.

Dev tip: `window.__game` is exposed in dev builds for debugging.
