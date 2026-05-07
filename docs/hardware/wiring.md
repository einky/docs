---
sidebar_position: 2
---

# Wiring

## Overview

```
USB-C (5V) ──────────────────────────────► RPi Zero 2W
                                               │
                          GPIO ◄───────────── Buttons (×7)
                          SPI  ──────────────► GDEM0397T81P (3.3V)
```

## SPI — Display

The GDEM0397T81P communicates with the Pi over SPI at 3.3V logic.

| Signal | Pi pin | Notes |
|--------|--------|-------|
| MOSI | GPIO 10 (SPI0 MOSI) | Data to display |
| SCLK | GPIO 11 (SPI0 SCLK) | Clock |
| CS | GPIO 8 (SPI0 CE0) | Chip select |
| DC | TBD | Data/Command select |
| RST | TBD | Hardware reset |
| BUSY | TBD | Panel busy signal |

:::note
Exact pin assignments are defined in the C SPI driver in the `renpy_rework` repository.
:::

## GPIO — Buttons

Seven buttons are wired to GPIO pins with pull-up or pull-down resistors. See [Input System](../input-system) for the logical mapping.

## Power

The Pi is powered via its USB-C port. The battery connects directly without a power management IC in the current revision.
