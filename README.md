# NetOps: Office Network Engineer

A NOC / CCNA troubleshooting simulation game. Watch a software company's office from above, take incident reports, investigate with Cisco IOS-style, Windows and Linux commands, fix the root cause, and verify.

## Run
```
npm install
npm run dev      # http://localhost:5173
npm test         # 48 tests: engine, CLI, every scenario solvable, pacing, reproducibility
npm run build    # type-check + production build into dist/
```

## Architecture
- `src/net/` – stateful network model and engine (L1 link/PoE → L2 VLANs/trunks/STP/MAC tables → L3 routing/ARP/ACL/NAT, DHCP, DNS, Wi-Fi), plus CLIs in `net/cli/` (IOS, Windows, Linux).
- `src/incidents/` – 30 scenarios (root cause, symptoms, checklist, outcome-based verification, hints, scripted solution used by tests) and the director (pacing, caps, cooldowns, escalation) in `sim/game.ts`.
- `src/world/` – office layout, roster, pathfinding, employee behaviour.
- `src/sim/` – `Game` orchestrator: clock, productivity, economy, inbox/tasks/manager, persistence (localStorage), deterministic sub-stepping.
- `src/render/` – procedural Canvas 2D renderer (no external assets). `src/ui/` – React panels.
- `src/content/` – manual/runbook, shop, message text.

Dev tip: `window.__game` is exposed in dev builds for debugging.
