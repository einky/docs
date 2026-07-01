---
sidebar_position: 4
---

# ESP-32 dev bridge

A dev path alongside the socket preview and the on-Pi SPI driver: render any Ren'Py game into Xvfb on your workstation, then stream frames over WiFi to an **ESP-32** that drives a spare Waveshare 7.5" 800×480 panel, with its buttons fed back to the host. Useful for seeing a *real* panel update — with *real* buttons — without flashing an SD card.

It is a **dev tool only**, never part of a shipping image. Rationale and history: [ADR 0006](https://github.com/einky/meta/blob/main/adr/0006-esp32-dev-bridge.md).

```
Ren'Py SDK ─► Xvfb ─► runtime frame_processor ──TCP "EINK"──► ESP-32 ──SPI──► 7.5" e-ink
  (host)      (host)   (EINKY_BACKEND=tcp)        :5333         (firmware)
      ▲                                                            │
      │  xdotool keysym                                            │ button name
      └──── runtime input (EINKY_INPUT_BACKEND=net) ◄──TCP :5334───┘
```

## How it works

There is **one** bridge firmware — `runtime/firmware/esp32/` — and it speaks the **same protocols** as the production pipeline (no second implementation):

- **Frames:** the host's `runtime` frame processor captures Xvfb, dithers, packs 1-bit, and sends each frame with the `runtime` TCP backend. Wire format (from [`meta/shared/protocol.md`](https://github.com/einky/meta/blob/main/shared/protocol.md)):

  ```
  | "EINK" | u32 width LE | u32 height LE | 48000 bytes packed 1-bit |
  ```

  The firmware inverts bits before `GxEPD2::drawBitmap` (the pack convention is bit = 1 → white; the panel treats bit = 1 as black). It forces a full refresh every 30 frames to clear ghosting.

- **Input:** the ESP-32 debounces its 7 buttons and sends each press as a newline-delimited **button name** over a second TCP connection. The host's `runtime` input handler looks the name up in the shared keymap and injects the mapped keysym into the Xvfb display.

Both the button→pin map and the protocol constants come from
[`meta/shared/hardware.toml`](https://github.com/einky/meta/blob/main/shared/hardware.toml) — the firmware's `include/config.h` is derived from it, so the host and firmware never disagree on pins, names, or ports.

> **Note.** An earlier HTTP-based bridge under `launcher/bridge/` has been **retired** in favour of this one ([ADR 0006](https://github.com/einky/meta/blob/main/adr/0006-esp32-dev-bridge.md)). If you have an old checkout referencing `einky_bridge.py`, switch to the `runtime` TCP backend below.

## Prerequisites

On the host: `runtime`'s dev environment (`make setup`) plus `xdotool` (`sudo apt install xdotool`).

On the ESP-32 (PlatformIO): `GxEPD2` (Jean-Marc Zingg). Copy `include/config.h.example` to `include/config.h` and fill in your WiFi SSID/password and the host IP + ports, then `pio run -t upload`.

## Running

From `runtime/`, start both backends pointing at the bridge:

```bash
EINKY_BACKEND=tcp EINKY_TCP_PORT=5333 .venv/bin/python -m frame_processor &
EINKY_INPUT_BACKEND=net EINKY_INPUT_PORT=5334 .venv/bin/python -m input &
```

Then power up the ESP-32. Connection order doesn't matter — both sides reconnect on drop. The ESP prints its IP over serial at 115200 baud.

## WSL networking

WSL2 is NAT'd off the host network, so the ESP-32 cannot reach the WSL listener by default. Either enable **mirrored networking** (`[wsl2]\nnetworkingMode=mirrored` in `%USERPROFILE%\.wslconfig`, then restart WSL), or add a **port-proxy** forwarding ports 5333/5334 from the Windows host to the WSL VM. Full commands are in `runtime/firmware/esp32/README.md`.

## Troubleshooting

- **No frames** — confirm `frame_processor` is listening (`EINKY_BACKEND=tcp`) and the ESP reached it (`frame: connected` on serial). On WSL, see networking above.
- **Buttons don't register** — confirm the firmware logs `btn: <name>` and the host input handler logs the matching name. A name the host doesn't recognise means the firmware's button table drifted from `meta/shared/hardware.toml` — regenerate `config.h`.
- **`start` button hangs the ESP at boot** — its default pin is an ESP32 strapping pin; see the note in [ADR 0006](https://github.com/einky/meta/blob/main/adr/0006-esp32-dev-bridge.md).
- **Ghosting builds up** — lower the full-refresh interval for text-heavy scenes.
