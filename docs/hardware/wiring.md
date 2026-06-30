---
sidebar_position: 2
---

# Wiring

:::info Source of truth
These pin assignments are the rendering of
[`meta/shared/hardware.toml`](https://github.com/Crab-Ink-Gaming/meta/blob/main/shared/hardware.toml),
the single authoritative contract. `runtime` (the SPI driver + keymap) and the
ESP-32 firmware generate their constants from the same file. **Do not edit pins
here independently — change `hardware.toml` and regenerate.**
:::

## Overview

```
USB-C (5V) ──────────────────────────────► RPi Zero 2W
                                               │
                          GPIO ◄───────────── Buttons (×7)
                          SPI  ──────────────► GDEM0397T81P (3.3V)
```

## SPI — Display

The GDEM0397T81P (800×480) communicates with the Pi over SPI at 3.3V logic (`/dev/spidev0.0`). Pins are Raspberry Pi **BCM** numbers.

| Signal | BCM pin | Notes |
|--------|---------|-------|
| MOSI | 10 (SPI0 MOSI) | Data to display (DIN) |
| SCLK | 11 (SPI0 SCLK) | Clock |
| CS | 8 (SPI0 CE0) | Chip select |
| DC | 25 | Data/Command select |
| RST | 17 | Hardware reset |
| BUSY | 24 | Panel busy (active-high) |

## GPIO — Buttons

Seven buttons, each active-low with an internal pull-up and a 30 ms debounce. The `keysym` is injected on the X stack; the in-engine path queues the Ren'Py event instead.

| Button | BCM pin | Keysym | Ren'Py event | ESP-32 dev pin |
|--------|---------|--------|--------------|----------------|
| Up | 5 | `Up` | `focus_up` | 32 |
| Down | 6 | `Down` | `focus_down` | 33 |
| Left | 13 | `Left` | `focus_left` | 25 |
| Right | 19 | `Right` | `focus_right` | 26 |
| A | 16 | `space` | `dismiss` (advance) | 27 |
| B | 20 | `Escape` | `game_menu` (back) | 14 |
| Start | 21 | `Return` | select / confirm | 12 |

## Power

The Pi is powered via its USB-C port. The battery connects directly without a power management IC in the current revision (an IP5306 is planned for a future revision).
