---
sidebar_position: 1
---

# Prerequisites

The following tools and libraries are required to build or run einky.

## Hardware

| Item | Spec | Notes |
|------|------|-------|
| Raspberry Pi Zero 2W | — | The target platform |
| MicroSD card | 8 GB minimum | Holds InkyOS and games |
| GooDisplay GDEM0397T81P | 3.97" SPI e-ink panel | The display (800×480) |
| Li-Ion battery | 5000 mAh @ 5V 3A | Powers the Pi |
| 7× GPIO buttons | — | D-pad + 3 action buttons |
| USB-C cable | — | Power and data transfer |

Pin assignments for the panel and buttons are defined once in
[`meta/shared/hardware.toml`](https://github.com/einky/meta/blob/main/shared/hardware.toml)
and rendered on the [Wiring](../hardware/wiring) page.

## Software

### To build the device image (`buildroot_os` / InkyOS)

The build runs entirely in a container, so the host distro doesn't matter.

| Tool | Purpose |
|------|---------|
| Docker | Runs the pinned Debian Bookworm Buildroot build environment |
| QEMU (`qemu-system-aarch64`) | Boots the emulator image on the host |
| git | Clone + the Buildroot submodule |

No cross-toolchain, Python, or build libraries are needed on the host — the container provides everything.

### To work on the frame/input pipeline (`runtime`) on a workstation

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.14 (see `meta/versions.env`) | Frame processor, input handler |
| Pillow | Latest | Frame resize / image handling |
| numpy | Latest | Dither + packing |
| Xvfb | Any | Virtual framebuffer for headless rendering |
| mesa-utils / libgl1-mesa-dri | Any | Software OpenGL for the Ren'Py SDK |
| Ren'Py SDK | Pinned (see `versions.env`) | Installed by `meta/scripts/install-renpy-sdk.sh` (verified by SHA256) |
| GCC / clang | Any | Compiling the C SPI driver |

`runtime`'s `make setup` provisions the Python venv and dev dependencies for you.

## Installing host dependencies (Debian/Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y \
  docker.io qemu-system-arm git \
  python3 python3-pip python3-venv \
  xvfb mesa-utils libgl1-mesa-dri \
  gcc build-essential
```
