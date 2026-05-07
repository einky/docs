---
sidebar_position: 2
---

# Setup & Running

:::note
A single unified setup script does not exist yet. Setup is currently per-repository.
:::

## Requirements

- Raspberry Pi Zero 2W
- MicroSD card with Raspbian Lite flashed
- SSH or UART access for initial setup

See [Prerequisites](./prerequisites) for the full list of dependencies.

## Initial setup

```bash
# 1. Flash Raspbian Lite to MicroSD and boot the Pi

# 2. Clone the aggregator repository
git clone https://github.com/Crab-Ink-gaming/crab-ink.git
cd crab-ink

# 3. Run the setup scripts to pull all repositories and install dependencies
# (individual scripts per component — see each repo's README)
```

## Running in dev mode

Dev mode uses a Unix socket for frame output. No e-ink hardware required.

```bash
# Start Xvfb (virtual framebuffer)
Xvfb :1 -screen 0 800x480x24 &

# Launch the engine with socket output
DISPLAY=:1 python3 launcher/main.py --output socket
```

## Running on hardware

Requires the GDEM0397T81P panel connected over SPI.

```bash
# Start Xvfb
Xvfb :1 -screen 0 800x480x24 &

# Launch with SPI output
DISPLAY=:1 python3 launcher/main.py --output spi
```

## Dev vs. production output

| Mode | Output target | Use case |
|------|--------------|---------|
| `--output socket` | Unix socket → local viewer | Development, no hardware needed |
| `--output spi` | C SPI driver → GDEM0397T81P | Production, real hardware |
