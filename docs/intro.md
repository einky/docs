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

The system runs a custom Raspbian-based OS, a modified Ren'Py engine, and a minimal Python launcher — all rendering through a virtual framebuffer that feeds frames to the e-ink panel over SPI.

## How it works

```
Ren'Py (headless, under Xvfb)
  → Frame captured by Python/Pillow
  → Resize → Greyscale → Floyd-Steinberg dither
  → SPI driver (C) → GDEM0397T81P e-ink panel
```

## Project links

| Resource | Link |
|----------|------|
| GitHub Organization | [Crab-Ink-Gaming](https://github.com/Crab-Ink-gaming) |
| Documentation | [docs.inky.top](https://docs.inky.top) |

## Where to go next

- **[Prerequisites](./getting-started/prerequisites)** — what you need to build or run Inky
- **[Setup](./getting-started/setup)** — how to get the project running
- **[Architecture](./architecture/overview)** — how all the pieces fit together
