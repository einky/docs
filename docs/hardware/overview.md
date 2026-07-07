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
- Controller IC: **Solomon Systech SSD1677** (this dictates the SPI command set
  in `runtime`'s C driver — write-RAM `0x24`, update-control `0x22`, master
  activation `0x20`; BUSY is active-high)
- Interface: **SPI**
- Logic voltage: **3.3V**
- Supports both full refresh and partial refresh

The panel does not accept a live video signal. Frames must be pushed explicitly via SPI after processing — the dither/refresh pipeline lives in the [`runtime`](../architecture/overview#repo-layout) repo, and the exact pins are defined in the [Wiring](./wiring) contract.

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

Seven GPIO buttons are wired directly to the Pi with internal pull-ups (active-low). The button → key/event mapping is defined in the [`meta/shared`](../architecture/overview#the-shared-contract) hardware contract and consumed by `runtime`; see [Wiring](./wiring) for the table.
