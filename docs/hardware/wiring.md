---
sidebar_position: 2
---

# Wiring

:::info Source of truth
These pin assignments are the rendering of
[`meta/shared/hardware.toml`](https://github.com/einky/meta/blob/main/shared/hardware.toml),
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

## Changing a pin

Pins are **never edited in a downstream repo directly.** `meta/shared/hardware.toml`
is the single source of truth; every consumer regenerates its own constants from it,
and CI fails the build if any committed file drifts out of sync. To move a signal:

:::warning The build does NOT read `hardware.toml`
The image bakes in **committed, pre-generated files** — not the contract. `hardware.toml`
is only their upstream source, linked by a manual `gen` step you must run in **each**
consumer repo. Editing the contract alone changes nothing in the image until you
regenerate and rebuild. And the pins that actually drive the panel and buttons at
runtime live in **`runtime`** (`src/spi_driver/contract.h`, `src/input/keymap.py`), not
in `config.txt` — `config.txt` only enables the SPI bus and sets boot-time button
pull-ups. Regenerating `buildroot_os` alone is **not** enough; you must regenerate
`runtime` too (Step 2).
:::

### 1. Edit the contract

Change the value in [`meta/shared/hardware.toml`](https://github.com/einky/meta/blob/main/shared/hardware.toml):

```toml
# Example: move the display RESET line from BCM 17 to BCM 27
[spi]
rst = 27

# Example: remap the "a" button to BCM 12
[[button]]
name = "a"
bcm  = 12
```

:::warning Which pins are actually movable
The three **hardware SPI0** signals — `mosi` (BCM 10), `sclk` (BCM 11), and `cs`
(BCM 8, CE0) — are fixed to their ALT0 function pins on the Pi. Changing those numbers
in the contract will **not** rewire hardware SPI0; it only relabels the documentation.
Moving them for real means switching to software SPI or SPI1, which is a driver change,
not a contract edit.

The freely reassignable GPIOs are the display's **`dc` / `rst` / `busy`** (driven via
libgpiod) and **all seven buttons**. Keep off the SPI0/UART pins and other special-function
lines when picking new numbers.
:::

### 2. Regenerate the derived files in each consumer

Each repo has a generator that renders committed files from the contract:

```bash
# buildroot_os — regenerates board/inky/config.txt (SPI + button pull-ups)
# and the in-engine input_hook.rpy button map.
cd buildroot_os && python3 scripts/gen_hardware.py

# runtime — regenerates the keymap and the SPI driver's pin header.
cd runtime && make gen
```

`buildroot_os` runs a parity check automatically on every build (`./br.sh` calls
`scripts/gen_hardware.py --check` before Buildroot runs), so forgetting to regenerate
**buildroot_os's own** files fails the build rather than shipping stale. But that check
does **not** cover `runtime` — a forgotten `make gen` there is caught only by `runtime`'s
own CI (`make gen-check`), so regenerate both by hand. Both checks also skip silently if
the `meta` repo isn't checked out beside these repos, and `INKY_SKIP_CHECKS=1` bypasses
the buildroot_os one.

:::note Not the same as version pins
`buildroot_os/scripts/check_pins.py` verifies **software version pins** against
`meta/versions.env` — unrelated to GPIO pins despite the name. GPIO pin parity is
`gen_hardware.py --check`.
:::

### 3. Rebuild and re-flash

The regenerated `config.txt` sets the boot-time pull-ups and SPI bus; the runtime picks
up the new GPIO/SPI numbers from its regenerated constants. Rebuild the hardware image
and write it to the card:

```bash
cd buildroot_os && ./build.sh pi
sudo dd if=output/images/sdcard.img of=/dev/sdX bs=4M conv=fsync status=progress
```

See [Flashing InkyOS to an SD card](./flashing) for the full flashing procedure. Then
**rewire the panel and buttons** to match the new assignments before booting.
