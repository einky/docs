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

The device runs **InkyOS**, a purpose-built **Buildroot** appliance image that boots straight into Ren'Py. There is no package manager and no desktop in the boot path. Ren'Py renders headless into a virtual framebuffer; a frame pipeline dithers each frame to 1-bit and pushes it to the e-ink panel over SPI, and the seven hardware buttons are fed back into the engine as input.

## How it works

```
InkyOS boots → Xvfb virtual display → Ren'Py renders the game headless
  → frame captured (Floyd–Steinberg dither → 1-bit pack)
  → SPI driver (C) → GDEM0397T81P e-ink panel
  ← 7 GPIO buttons → key/event injection back into Ren'Py
```

The same frame + input pipeline serves the **launcher** (itself a Ren'Py game that acts as the boot menu) and every game it starts.

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
