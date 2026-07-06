---
sidebar_position: 1
---

# Architecture Overview

:::note
This page describes the design as **implemented and verified on the QEMU
emulator** (2026-07-07). The only major unvalidated area is physical hardware
bring-up (real panel, real buttons, real Wi-Fi) — see
[Integration status](./integration-status) and the [Roadmap](../roadmap/roadmap.md).
:::

einky is a **polyrepo** under the [einky](https://github.com/einky) GitHub organization. Each repo has a single, narrow responsibility; the `meta` repo bootstraps a clone of every other one as siblings on disk and holds the **shared cross-repo contract**.

## The system in one paragraph

The device is a Raspberry Pi Zero 2 W driving an 800×480 **1-bit e-ink panel**
(GooDisplay GDEM0397T81P) over SPI, with **seven GPIO buttons** for input.
It boots **InkyOS** (a Buildroot appliance image) straight into
**`inky-launcher`** — a lightweight pure-Python dashboard that renders the game
library and settings with Pillow and **owns the panel and the buttons for the
whole uptime** ([ADR 0009](https://github.com/einky/meta/blob/main/adr/0009-native-python-launcher.md)).
When the player picks a game, the launcher brings up Xvfb, spawns **Ren'Py** as
a supervised child process, and bridges the game's frames and input over two
Unix sockets: the game pushes one PNG per stable frame (via a one-patch engine
hook), the launcher dithers it to 1-bit through the shared `runtime` pipeline
and pushes it to the panel, and button presses are forwarded the other way.
When the game exits (or the player holds **Start**), the launcher returns to
the library.

## Repo layout

```
einky/                   # workspace parent (any name)
├── meta/                # bootstrap, ADRs, versions.env, and shared/ contract
│   └── shared/          # single source of truth: hardware.toml + protocol.md
├── .github/             # org profile, shared workflows, issue templates
├── docs/                # this site (Docusaurus)
├── buildroot_os/        # InkyOS — the Buildroot device image
├── runtime/             # frame pipeline, keymap, C SPI driver (shared library)
├── launcher/            # native Python game-library + settings dashboard
├── server/              # FastAPI backend (catalog, telemetry)
├── web/                 # web frontend (admin / store / management)
├── case/                # enclosure CAD, BOM, wiring
└── games/               # Ren'Py game projects
```

| Repo | Responsibility |
|---|---|
| `meta` | Workspace entry point. Hosts `bootstrap.sh`, `versions.env`, the local Docker dev stack, the ADRs, and **`shared/`** — the one place the pinout, keymap, and wire protocols are defined. |
| `docs` | Human-readable design docs and guides — what you are reading now. |
| `buildroot_os` | **InkyOS.** A Buildroot `br2-external` tree that builds the device image: kernel + Mesa `llvmpipe` + Xvfb + Python 3 + Ren'Py (from source) + the `inky-runtime`, `inky-launcher`, and `inky-session` packages. Two targets: Pi Zero 2 W hardware and a QEMU `virt` emulator. |
| `runtime` | **Canonical owner of the shared on-device logic** ([ADR 0008](https://github.com/einky/meta/blob/main/adr/0008-shared-hardware-contract.md)): the greyscale → Floyd–Steinberg dither → 1-bit pack pipeline, the contract keymap, the C SPI panel driver (`libgpiod` + `/dev/spidev0.0`), and the frame/input socket plumbing. Consumed as a library by the launcher and as the `inky-runtime` Buildroot package. |
| `launcher` | **The boot UI** ([ADR 0009](https://github.com/einky/meta/blob/main/adr/0009-native-python-launcher.md)): a native Python app (`einky-launcher`) — game library, settings (display refresh, Wi-Fi, power), and the game-session manager that spawns and supervises Ren'Py games. *Not* a Ren'Py game (that was ADR 0005, superseded). |
| `server` | FastAPI backend serving the game catalog and telemetry. See [Server research](./server-research). |
| `web` | Web frontend for the catalog and admin tooling. Talks to `server`. |
| `case` | Enclosure CAD, BOM, wiring diagrams. |
| `games` | Ren'Py game sources shipped with or sideloaded onto the device. (Today the image bundles the upstream tutorial `the_question` as a test fixture, assembled at build time.) |

> **History.** The device image was previously built with pi-gen (the archived
> `os` repo — [ADR 0007](https://github.com/einky/meta/blob/main/adr/0007-buildroot-os.md)),
> and the launcher was previously a Ren'Py game (ADR 0005, superseded by ADR 0009).
> The ESP32 dev bridge (ADR 0006) is retired as a bring-up artifact.

## The shared contract

Panel geometry, the GPIO/SPI pin map, the button→event bindings, and the
byte-level wire protocols live **once** in `meta/shared/`
(`hardware.toml`, `protocol.md`). Each repo commits *generated* constants
derived from the contract and CI-checks them for drift:

- `runtime`: `make gen` → `src/input/keymap.py`, `src/spi_driver/contract.h`, `src/frame_processor/constants.py`
- `buildroot_os`: `scripts/gen_hardware.py` → `board/inky/config.txt`, the in-engine `input_hook.rpy` button map
- `docs`: the [Wiring](../hardware/wiring) page is rendered from the same table

**The build does not read the contract directly** — regeneration is a manual
step in each consumer repo (guarded by `--check` in CI / `br.sh`). See
[Wiring → Changing a pin](../hardware/wiring).

## Engine model

- **On developer workstations:** the **vanilla upstream Ren'Py SDK**, installed unmodified by the pinned `meta/scripts/install-renpy-sdk.sh` (version + SHA256 from `versions.env`).
- **On the device:** InkyOS builds the **same Ren'Py version from source** as a Buildroot package, running on Mesa **`llvmpipe`** software desktop GL under Xvfb (the Pi's VideoCore only exposes GL ES, which Ren'Py can't use). It carries exactly one patch, adding `config.eink_push_callback`, so a game can ship one stable frame per advance to the launcher's frame receiver.

Everything else einky-specific lives **outside** the engine: in `runtime` (the
pipeline library), `launcher` (the shell), and per-game hook files
(`eink_hook.rpy` / `input_hook.rpy`) layered onto each game at image build time.

## Process & ownership model (ADR 0009)

```
BusyBox init
  └── S95inky-session → inky-session.sh (supervisor: restart on crash)
        └── inky-launcher                 ← owns SPI panel + GPIO buttons, always
              ├── renders menu frames itself (Pillow → 1-bit → panel)
              └── on "play":
                    ├── ensure Xvfb :0 (started on demand, reused)
                    ├── GameFrameReceiver ← binds /tmp/renpy-eink.sock
                    ├── spawn Ren'Py game (own process group, env: DISPLAY,
                    │     LIBGL_ALWAYS_SOFTWARE, RENPY_EINK_SOCKET, RENPY_INPUT_SOCKET)
                    ├── forward button presses → /tmp/renpy-input.sock
                    └── on exit / hold-Start → tear down, back to library
```

There is exactly **one owner** of each hardware resource for the whole uptime:
the launcher holds `/dev/spidev0.0` and the gpiozero buttons; games never touch
either. Games only speak the two engine-capture sockets.

## The frame + input pipeline

One dither/pack implementation (`runtime/src/frame_processor/`), several
capture sources and dispatch backends. Full byte formats:
[protocol.md](https://github.com/einky/meta/blob/main/shared/protocol.md).

```
 producers                       process (single impl)            dispatch (launcher backend)
┌──────────────────────────┐
│ launcher UI (Pillow "1") │─────────── already 1-bit ─────────┐  ┌─ SpiBackend  → C driver → panel
├──────────────────────────┤                                   ├──┼─ TcpBackend  → :5333 preview (QEMU/host)
│ game PNG frames           │──► greyscale → Floyd–Steinberg    │  └─ PngBackend  → numbered PNGs (tests)
│ (eink_push_callback →     │    dither → pack 1-bit (MSB)  ────┘
│  /tmp/renpy-eink.sock)    │
└──────────────────────────┘

 input:  GPIO buttons │ TCP :5334 │ stdin  ──► launcher event queue
   menu mode   → the top screen handles the event
   in-game     → forwarded as button names → /tmp/renpy-input.sock
                 → input_hook.rpy queues the mapped renpy_events
                 (hold Start 2 s = exit-game combo, handled by the launcher)
```

- **Refresh policy:** partial refresh for cursor moves, full refresh on screen
  transitions and every `full_refresh_every` frames (default 30, tunable in
  Settings) to clear ghosting. The launcher decides; that control is the core
  reason it is not a Ren'Py game.
- **Frame wire format** (`EINK` + u32 width + u32 height + 48 000 packed bytes,
  bit = 1 → white; the SPI driver inverts) is identical on every dispatch
  backend.
- **Input wire format** is newline-delimited ASCII button *names*
  (`up/down/left/right/a/b/start`) from the shared contract, on every transport.

Details: [Frame & input pipeline](../software/frame-pipeline).

## Boot sequence (InkyOS)

```
power on
  → (Pi) GPU firmware reads config.txt (SPI on, button pull-ups) → kernel
  → BusyBox init → S95inky-session
  → inky-session.sh exports the per-target env (/etc/default/inky-session)
    and supervises inky-launcher in a restart loop
  → launcher initialises its display backend (spi on Pi, tcp on the emulator)
    and input source (gpio on Pi, tcp on the emulator) and renders the library
  → user selects a game → launcher spawns Ren'Py under Xvfb; on exit, back to
    the library
```

Details: [Boot & session](../software/boot-and-session).

## Where data lives

| Concern | Lives in |
|---|---|
| Game projects | `/opt/games/<slug>/` on the image; scanned by the launcher (`EINKY_GAMES_DIR`) |
| Game metadata | optional `inky-manifest.toml` per game (title, author, sort key) |
| Settings, cover cache, game logs | `/var/lib/inky` (`EINKY_STATE_DIR`) |
| Catalog metadata (future) | `server/` (Postgres) |
| Pinout, keymap, wire protocols | `meta/shared/` |
| Build pinned versions | `meta/versions.env` |
