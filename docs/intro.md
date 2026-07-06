---
sidebar_position: 1
slug: /intro
---

# Welcome to einky

**einky** is a custom handheld console designed to run Ren'Py visual novels and narrative games on an e-ink display.

> An End-of-Studies Project (EIP) developed at Epitech Montpellier.

## What is einky?

einky runs on a **Raspberry Pi Zero 2W** with a **3.97" e-ink panel** (800×480px). The core goals are:

- **Minimal battery consumption** — e-ink holds a frame without power
- **Zero blue light emission** — no backlit screen
- **Distraction-free reading** — purpose-built for visual novels

The device runs **InkyOS**, a purpose-built **Buildroot** appliance image that boots straight into the **einky launcher** — a native Python game library and settings dashboard. There is no package manager and no desktop in the boot path. When the player picks a game, the launcher spawns Ren'Py, which renders headless into a virtual framebuffer and pushes one PNG per stable frame back to the launcher; the shared frame pipeline dithers it to 1-bit (Floyd–Steinberg) and drives the e-ink panel over SPI, while the seven hardware buttons are forwarded to the engine as input.

## How it works

```
InkyOS boots → inky-launcher (native Python; owns the SPI panel + GPIO buttons)
  menu: Pillow-rendered 1-bit frames → panel (partial/full refresh control)
  play: launcher spawns Ren'Py under Xvfb (software GL)
          game → PNG per stable frame → dither → 1-bit → SPI → e-ink panel
          buttons → launcher → input socket → Ren'Py events
  exit (or hold Start) → back to the library
```

The launcher owns the panel and buttons for the whole uptime and supervises every game session ([ADR 0009](https://github.com/einky/meta/blob/main/adr/0009-native-python-launcher.md)); games only speak two Unix sockets.

> **On the engine.** Developer workstations use the vanilla upstream Ren'Py SDK. On the device, InkyOS builds the *same* Ren'Py version from source as a Buildroot package, with one small e-ink patch (`config.eink_push_callback`). See the [Architecture Overview](./architecture/overview).

## Project links

| Resource | Link |
|----------|------|
| GitHub Organization | [einky](https://github.com/einky) |
| Documentation | [docs.einky.fr](https://docs.einky.fr) |

## Where to go next

- **[Prerequisites](./getting-started/prerequisites)** — what you need to build or run einky
- **[Setup](./getting-started/setup)** — build InkyOS and run the dev loop
- **[Developer onboarding](./getting-started/developers)** — clone the workspace via `meta/bootstrap.sh`
- **[Architecture](./architecture/overview)** — how all the pieces fit together
- **[Software deep dive](./software/boot-and-session)** — boot chain, frame pipeline, launcher internals, build system
- **[Roadmap](./roadmap/roadmap.md)** — what's done, what's next, and in what order
