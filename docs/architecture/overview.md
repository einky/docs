---
sidebar_position: 1
---

# Architecture Overview

:::note
This page describes the **target** design. For what is actually wired together
today — and where `runtime`, `games`, and the launcher still need integration —
see [Integration status & roadmap](./integration-status).
:::

einky is a **polyrepo** under the [einky](https://github.com/einky) GitHub organization. Each repo has a single, narrow responsibility; the `meta` repo bootstraps a clone of every other one as siblings on disk and holds the **shared cross-repo contract**.

## Repo layout

```
einky/                   # workspace parent (any name)
├── meta/                # bootstrap, ADRs, versions.env, and shared/ contract
│   └── shared/          # single source of truth: hardware.toml + protocol.md
├── .github/             # org profile, shared workflows, issue templates
├── docs/                # this site (Docusaurus)
├── buildroot_os/        # InkyOS — the Buildroot device image
├── runtime/             # frame + input pipeline, SPI driver, ESP32 dev bridge
├── launcher/            # Ren'Py game shown at boot — the menu
├── server/              # FastAPI backend (catalog, telemetry)
├── web/                 # web frontend (admin / store / management)
├── case/                # enclosure CAD, BOM, wiring
└── games/               # Ren'Py game projects
```

| Repo | Responsibility |
|---|---|
| `meta` | Workspace entry point. Hosts `bootstrap.sh`, `versions.env`, the local Docker dev stack, the ADRs, and **`shared/`** — the one place the pinout, keymap, and wire protocols are defined. |
| `docs` | Human-readable design docs and guides — what you are reading now. |
| `buildroot_os` | **InkyOS.** A Buildroot `br2-external` tree that builds the device image and boots straight into a Ren'Py game. Builds Ren'Py from source; consumes `runtime`'s on-device logic. |
| `runtime` | **Canonical owner of the on-device logic:** the framebuffer→e-ink frame pipeline (capture, Floyd–Steinberg dither, dispatch), the GPIO/input handler and keymap, the C SPI driver, and the ESP32 dev bridge. |
| `launcher` | A **Ren'Py game** that acts as the boot menu. Scans `games/` and starts the selected title. |
| `server` | FastAPI backend serving the game catalog and telemetry. See [Server research](./server-research). |
| `web` | Web frontend for the catalog and admin tooling. Talks to `server`. |
| `case` | Enclosure CAD, BOM, wiring diagrams. |
| `games` | Ren'Py game sources shipped with or sideloaded onto the device. |

> **History.** The device image was previously built with pi-gen (the archived `os` repo). It is now the Buildroot **InkyOS** appliance — see [ADR 0007](https://github.com/einky/meta/blob/main/adr/0007-buildroot-os.md). All earlier pi-gen workflows are retired.

## The shared contract

Everything that used to be duplicated across repos — panel geometry, the GPIO/SPI pin map, the button→key/event bindings, and the byte-level wire protocols — now lives **once** in `meta/shared/` (`hardware.toml`, `protocol.md`). Each repo derives its constants from that file rather than hard-coding them. The [Wiring](../hardware/wiring) page is rendered from the same table.

## Engine model

- **On developer workstations:** the **vanilla upstream Ren'Py SDK**, installed unmodified by the pinned `meta/scripts/install-renpy-sdk.sh` (version + SHA256 from `versions.env`).
- **On the device:** InkyOS builds the **same Ren'Py version from source** as a Buildroot package, running on Mesa **`llvmpipe`** software desktop GL (the Pi's VideoCore only exposes GL ES, which Ren'Py can't use). It carries one small patch adding `config.eink_push_callback` so a game can ship one stable frame per advance to the e-ink pipeline.

Everything else einky-specific lives **outside** the engine, in `runtime` (the frame/input pipeline) and in the Ren'Py projects themselves (`launcher`, `games`).

## The frame + input pipeline (owned by `runtime`)

```
 capture ──► greyscale ──► Floyd–Steinberg dither ──► pack 1-bit ──► dispatch
   │                          (single implementation)                  │
   ├─ external: xwd/mss from Xvfb                          ┌─ SPI driver → e-ink panel
   └─ in-engine: config.eink_push_callback → PNG socket    ├─ Unix socket → dev preview
                                                           └─ TCP → ESP32 dev bridge
 input ◄── button name ◄── GPIO handler │ ESP32 (TCP) │ in-engine socket
       └─► keymap (meta/shared/hardware.toml) ─► keysym (xdotool/uinput) or renpy.queue_event
```

There is exactly **one** dither/dispatch implementation (`runtime/src/frame_processor/`) and **one** keymap (`runtime/src/input/`, generated from the shared contract). `buildroot_os` consumes them as a Buildroot package instead of reimplementing. Full byte formats: [protocol.md](https://github.com/einky/meta/blob/main/shared/protocol.md).

## Boot sequence (InkyOS)

```
power on
  → BusyBox init → inky-session service
  → Xvfb virtual display comes up
  → Ren'Py renders the launcher (boot menu) headless into Xvfb
  → runtime pipeline pumps frames to e-ink and buttons back into Ren'Py
  → user selects a game → launcher starts it; on exit, back to the menu
```

## Where data lives

| Concern | Lives in |
|---|---|
| Game binaries / assets | `games/` on disk; started by the launcher |
| Catalog metadata | `server/` (Postgres) |
| Pinout, keymap, wire protocols | `meta/shared/` |
| Build pinned versions | `meta/versions.env` |
