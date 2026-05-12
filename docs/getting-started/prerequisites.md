---
sidebar_position: 1
---

# Prerequisites

The following tools and libraries are required to build or run any component of the einky project.

## Hardware

| Item | Spec | Notes |
|------|------|-------|
| Raspberry Pi Zero 2W | — | The target platform |
| MicroSD card | 8 GB minimum | Holds the OS and games |
| GooDisplay GDEM0397T81P | 3.97" SPI e-ink panel | The display |
| Li-Ion battery | 5000 mAh @ 5V 3A | Powers the Pi |
| 7× GPIO buttons | — | D-pad + 3 action buttons |
| USB-C cable | — | Power and data transfer |

## Software

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.10+ | Launcher, frame processor, input handler |
| Pillow | Latest | Frame dithering and resize |
| numpy | Latest | Numerical operations in frame processing |
| Xvfb | Any | Virtual framebuffer for headless rendering |
| mesa-utils / libgl1-mesa-dri | Any | Software OpenGL required by the Ren'Py SDK |
| Ren'Py SDK | 8.x (vanilla) | Installed by `meta/scripts/install_sdk.sh`; not modified |
| GCC | Any | Compiling C modules and the SPI driver |
| pi-gen | Latest | OS image build (optional, for image builds) |

## Installing dependencies on Raspbian

```bash
sudo apt-get update
sudo apt-get install -y \
  python3 python3-pip \
  xvfb mesa-utils libgl1-mesa-dri \
  gcc build-essential

pip3 install pillow numpy
```
