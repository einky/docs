---
sidebar_position: 1
---

# Architecture Overview

Inky is split across **ten repositories** under the [Crab-Ink-Gaming](https://github.com/Crab-Ink-gaming) GitHub organization. Each repo has a single, narrow responsibility; the `meta` repo bootstraps a clone of every other one as siblings on disk.

## Repo layout

```
einky/                   # workspace parent (any name)
├── .github/             # org profile, shared workflows, issue templates
├── meta/                # workspace bootstrap, ADRs, shared scripts
├── docs/                # this site (Docusaurus)
├── os/                  # pi-gen recipe building the Raspberry Pi OS image
├── runtime/             # on-device Python supervisor
├── launcher/            # Ren'Py game shown at boot — the menu
├── server/              # FastAPI backend (catalog, telemetry)
├── web/                 # web frontend (admin / store / management)
├── case/                # enclosure CAD, BOM, wiring
└── games/               # Ren'Py game projects
```

| Repo | Responsibility |
|---|---|
| `.github` | Org-wide GitHub config — profile README, reusable workflows, issue templates. |
| `meta` | Single entry point for contributors. Hosts `bootstrap.sh`, `versions.env`, the local Docker dev stack, and the ADRs surfaced under the **Architecture Decisions** section of this sidebar. |
| `docs` | Human-readable design docs and guides — what you are reading now. |
| `os` | pi-gen-based image build. Produces the SD card image with the runtime, launcher, and SDK pre-installed. |
| `runtime` | On-device Python supervisor. Owns the framebuffer-to-SPI pipeline, the input event loop, and the lifecycle of the Ren'Py SDK process (start/stop/swap project). |
| `launcher` | A **Ren'Py game** that acts as the boot menu. The runtime starts it like any other title; selecting an entry tells the runtime to swap projects and re-launch the SDK. |
| `server` | FastAPI backend serving the game catalog, telemetry ingestion, and management endpoints. See [Server research](./server-research). |
| `web` | Web frontend for the catalog and admin tooling. Talks to `server`. |
| `case` | Enclosure CAD, BOM, wiring diagrams. |
| `games` | Ren'Py game sources shipped with or sideloaded onto the device. |

## Engine model

Inky uses the **vanilla Ren'Py SDK orchestrated by a custom runtime** — there is no fork, no patched engine, no rebuilt binary. The SDK is downloaded as released by Ren'Py upstream (see `meta/scripts/install_sdk.sh`) and run unmodified.

Everything Inky-specific lives outside the engine:

- **`runtime/`** is the supervisor. It launches the SDK against the active project, captures rendered frames from Xvfb, runs the dither pipeline, pushes bytes to the e-ink driver, and translates GPIO button presses into Ren'Py keyboard events.
- **`launcher/`** is the boot UI. Because it is a regular Ren'Py game, the same display pipeline that draws every other title also draws the menu — there is no separate render path.

## Boot sequence

```
power on
  → systemd starts runtime (PID 1 child)
  → runtime starts Xvfb + spawns Ren'Py SDK on launcher game
  → user presses a button → launcher dispatches a "play <game>" intent over a local socket
  → runtime stops the launcher SDK process, swaps the project path, restarts the SDK
  → game runs; quitting the game returns to the launcher (same swap, in reverse)
```

## Where data lives

| Concern | Lives in |
|---|---|
| Game binaries / assets | `games/` on disk; managed by the runtime |
| Catalog metadata | `server/` (Postgres) |
| Build pinned versions | `meta/versions.env` |
