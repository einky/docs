---
sidebar_position: 1
---

# Hardware Overview

## Bill of materials

| Component | Model / Spec | Notes |
|-----------|-------------|-------|
| **SoC** | Raspberry Pi Zero 2W | Quad-core Cortex-A53 @ 1GHz, 512MB RAM |
| **Display** | GooDisplay GDEM0397T81P | 3.97", 800×480px, SPI interface |
| **Battery** | Li-Ion 5000mAh @ 5V 3A | No power management IC for now (IP5306 planned) |
| **Input** | 7× GPIO buttons | 1× D-pad (4 directions) + 3× action buttons |
| **Storage** | MicroSD | OS + games |
| **Connectivity** | USB-C | Power and data transfer |
| **Enclosure** | Custom 3D-printed case | See the `case` repository |

## Display

The **GooDisplay GDEM0397T81P** is a 3.97-inch e-ink panel:

- Resolution: **800×480 pixels**
- Interface: **SPI**
- Logic voltage: **3.3V**
- Supports both full refresh and partial refresh

The panel does not accept a live video signal. Frames must be pushed explicitly via SPI after processing. See [Display Pipeline](../display-pipeline) for details.

## Compute

The **Raspberry Pi Zero 2W** provides:

- Quad-core ARM Cortex-A53 @ 1GHz
- 512MB LPDDR2 RAM
- Wi-Fi 802.11b/g/n
- Bluetooth 4.2
- MicroSD storage
- USB-C for power and data

## Power

A 5000mAh Li-Ion battery powers the Pi via the USB-C port at 5V 3A. There is currently no power management IC. The **IP5306** is planned for a future revision to provide battery protection, a boost converter, and a hardware ON/OFF switch.

## Input

Seven GPIO buttons are wired directly to the Pi with pull-up/pull-down resistors. See [Input System](../input-system) for the full mapping.
