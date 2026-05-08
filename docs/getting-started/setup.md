---
sidebar_position: 2
---

# Setup & Running

For a fresh clone of the full workspace, see [Developer onboarding](./developers) — it walks through `meta/bootstrap.sh`, which is the canonical entry point.

## Requirements

- Raspberry Pi Zero 2W
- MicroSD card with Raspbian Lite flashed
- SSH or UART access for initial setup

See [Prerequisites](./prerequisites) for the full list of dependencies.

## Running in dev mode

Dev mode uses a Unix socket for frame output. No e-ink hardware required.

```bash
# Start Xvfb (virtual framebuffer)
Xvfb :1 -screen 0 800x480x24 &

# Start the runtime, which boots the launcher (a Ren'Py game)
DISPLAY=:1 python3 -m runtime --output socket
```

## Running on hardware

Requires the GDEM0397T81P panel connected over SPI.

```bash
Xvfb :1 -screen 0 800x480x24 &
DISPLAY=:1 python3 -m runtime --output spi
```

## Dev vs. production output

| Mode | Output target | Use case |
|------|--------------|---------|
| `--output socket` | Unix socket → local viewer | Development, no hardware needed |
| `--output spi` | C SPI driver → GDEM0397T81P | Production, real hardware |
