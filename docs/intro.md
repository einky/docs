---
sidebar_position: 1
slug: /intro
---

# Welcome to Inky

**Inky** (a.k.a. Crab-Ink) is a custom handheld console designed to run Ren'Py visual novels and narrative games on an e-ink display.

> An End-of-Studies Project (EIP) developed at Epitech Montpellier.

## What is Inky?

Inky runs on a **Raspberry Pi Zero 2W** with a **3.97" e-ink panel** (800×480px). The core goals are:

- **Minimal battery consumption** — e-ink holds a frame without power
- **Zero blue light emission** — no backlit screen
- **Distraction-free reading** — purpose-built for visual novels

The system runs a custom Raspbian-based OS and the **vanilla Ren'Py SDK orchestrated by a custom runtime**. The runtime supervises a Ren'Py-based launcher game that acts as the boot menu, captures frames from a virtual framebuffer, and streams them to the e-ink panel over SPI.

## How it works

```
Runtime (Python supervisor) starts vanilla Ren'Py SDK
  → Ren'Py game (launcher or selected title) renders headless under Xvfb
  → Frame captured by Python/Pillow
  → Resize → Greyscale → Floyd-Steinberg dither
  → SPI driver (C) → GDEM0397T81P e-ink panel
```

The **launcher** is itself a Ren'Py game, not a Python wrapper around Ren'Py. At boot, the runtime starts the launcher game; selecting a title swaps the active project and re-launches the SDK against the new game.

## Project links

| Resource | Link |
|----------|------|
| GitHub Organization | [Crab-Ink-Gaming](https://github.com/Crab-Ink-gaming) |
| Documentation | [docs.einky.fr](https://docs.einky.fr) |

## Where to go next

- **[Prerequisites](./getting-started/prerequisites)** — what you need to build or run Inky
- **[Setup](./getting-started/setup)** — how to get the project running
- **[Developer onboarding](./getting-started/developers)** — clone the workspace via `meta/bootstrap.sh`
- **[Architecture](./architecture/overview)** — how all the pieces fit together
