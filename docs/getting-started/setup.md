---
sidebar_position: 2
---

# Setup & Running

For a fresh clone of the full workspace, see [Developer onboarding](./developers) — it walks through `meta/bootstrap.sh`, the canonical entry point.

There are two things you build/run: the **device image** (InkyOS) and the **frame/input pipeline** (`runtime`).

## Build & run InkyOS (the device image)

The build is containerized; QEMU runs on the host. *Develop against the emulator, validate against hardware.*

```bash
cd buildroot_os
git submodule update --init --recursive   # Buildroot is a pinned submodule

# Emulator target — fast, reliable day-to-day dev
./build.sh qemu        # -> output-qemu/
./run-qemu.sh          # boot it (serial console; log in as root)

# Hardware target — the actual shipping SD image
./build.sh pi          # -> output/images/sdcard.img
sudo dd if=output/images/sdcard.img of=/dev/sdX bs=4M conv=fsync   # check /dev/sdX!
```

InkyOS boots straight into Ren'Py via the `inky-session` service — no shell or desktop in the boot path.

## Run the frame/input pipeline in dev mode (`runtime`)

Dev mode emits frames to a Unix socket (or to the ESP32 dev bridge over TCP), so **no e-ink hardware is required**. Point the dev viewer at the socket to preview frames.

```bash
cd runtime
make setup        # venv + dev deps
make build-c      # compile the SPI driver C extension
make run-dev      # EINKY_BACKEND=socket -> tools/preview.py
```

On the Pi, the same pipeline runs against real hardware:

```bash
make run-prod     # EINKY_BACKEND=spi -> GDEM0397T81P over SPI
```

## Output backends

| `EINKY_BACKEND` | Output target | Use case |
|---|---|---|
| `socket` | Unix socket → `tools/preview.py` | Development, no hardware |
| `tcp` | TCP → ESP32 dev bridge → real panel | Demo on a real panel without a Pi ([ESP-32 bridge](./esp32-bridge)) |
| `spi` | C SPI driver → GDEM0397T81P | Production, on the Pi |

> Panel size, pins, and the button map come from
> [`meta/shared/hardware.toml`](https://github.com/Crab-Ink-Gaming/meta/blob/main/shared/hardware.toml) — never hard-code them.
