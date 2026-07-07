---
sidebar_position: 2
---

# Frame & input pipeline

How pixels get onto the e-ink panel and how button presses get back into the
software. The byte-level contract lives in
[`meta/shared/protocol.md`](https://github.com/einky/meta/blob/main/shared/protocol.md)
with its constants in
[`meta/shared/hardware.toml`](https://github.com/einky/meta/blob/main/shared/hardware.toml);
this page explains the running system.

## Design rule: one implementation, many endpoints

The greyscale → **Floyd–Steinberg dither** → **1-bit pack** step exists exactly
once, in `runtime/src/frame_processor/` (`processor.to_panel_grey`,
`dither.floyd_steinberg`, `dither.pack_1bit`). Every producer and consumer goes
through it (ADR 0008). What varies is only:

- **where pixels come from** — the launcher's own Pillow canvas, or PNG frames
  pushed by a running Ren'Py game;
- **where packed frames go** — the launcher's display backend: real panel,
  TCP preview, or PNG files.

## The frame path

```
 MENU (launcher UI)                        IN GAME (Ren'Py)
 Pillow "L" canvas                         engine renders under Xvfb (llvmpipe GL)
   │ threshold → mode "1"                    │ config.eink_push_callback (the one
   │                                         │ engine patch) fires once per stable
   │                                         │ frame → PNG over /tmp/renpy-eink.sock
   │                                         ▼
   │                                       GameFrameReceiver (launcher thread)
   │                                         │ decode PNG → to_panel_grey
   │                                         │ → floyd_steinberg → pack_1bit
   ▼                                         ▼
        packed 1-bit frame: 48 000 bytes (800×480 / 8, MSB-first, bit 1 = white)
                                │
                    DisplayBackend.show(frame, full=…)
                                │
      ┌─────────────────────────┼──────────────────────────┐
 SpiBackend                TcpBackend                  PngBackend
 runtime C driver          binds :5333, streams        numbered PNGs
 (libgpiod DC/RST/BUSY,    EINK-framed frames to       (golden/headless
 /dev/spidev0.0), panel    an attached preview          tests)
 init/partial/full/sleep   client; drops frames
                           when no client
```

### Frame wire format (`[protocol.frame]`)

Identical on every socket/TCP transport, little-endian, one frame per send,
connection persistent:

```
| 4 bytes | 4 bytes   | 4 bytes    | N bytes        |
| "EINK"  | u32 width | u32 height | packed 1-bit   |
```

`N = width/8 × height = 48 000` for the production panel. Packing is MSB-first
with **bit = 1 → white** (`numpy.packbits(grey >= 128)`); the SPI driver (and
any panel-side consumer) **inverts** before drawing because the panel treats
bit = 1 as the black foreground.

### Engine-capture format (`[protocol.engine_capture]`)

A game does not speak the frame protocol — it ships whole PNGs and lets the
launcher do the processing:

```
| 4 bytes         | M bytes |
| u32 length (BE) | PNG     |
```

on `/tmp/renpy-eink.sock` (override: `RENPY_EINK_SOCKET`). The sender is
`eink_hook.rpy`, a per-game hook file layered onto every game at image build
time; it connects lazily, retries every 2 s, and drops the connection cleanly on
error, so a game runs fine (just invisibly) with no receiver. The receiver
enforces an 8 MiB sanity cap per frame and drops undecodable frames without
dying.

## Refresh policy: partial vs full

e-ink partial refreshes are fast but accumulate ghosting; full refreshes flash
the panel but clear it. Explicit control over this trade-off is the core reason
the launcher is native Python (ADR 0009). The full decision rules — including
frame dedup, the changed-pixel threshold, dither stability, and panel-health
invariants — live in the [E-ink playbook](./eink-playbook.md); what ships
today is the simpler v1 below (the playbook is implemented by roadmap step D1):

- **Menu:** `RefreshPolicy` — full refresh on screen transitions and dialogs,
  and every `full_refresh_every` frames (default **30**, user-tunable in
  Settings → Display and persisted); everything else (cursor moves) is partial.
  Screens that report "nothing changed" skip rendering entirely.
- **In game:** the frame receiver counts frames and forces a full refresh every
  `full_refresh_every` frames; the rest are partial.
- Target frame rate is ~**2 FPS** (`[refresh] target_fps`) — the panel, not the
  CPU, is the bottleneck.

## The input path

```
 source (launcher-owned, one thread each)          consumer
 ┌ GpioSource   gpiozero Buttons, pull-up,         menu mode:
 │              30 ms debounce, hold detection       top Screen.handle(event)
 ├ TcpSource    ASCII names on :5334
 └ StdinSource  names on stdin (host dev)          in-game mode:
        │                                            ButtonEvent → NetInputSender
        ▼                                            → /tmp/renpy-input.sock
   event queue (ButtonEvent / HoldEvent               → input_hook.rpy →
   / GameExitEvent / RedrawEvent / QuitEvent)         renpy.queue_event(...)
```

### Input wire format (`[protocol.input]`)

Newline-delimited ASCII **button names** — never keysyms — on every transport:

```
up\n down\n left\n right\n a\n b\n start\n
```

The name table comes from `hardware.toml` `[[button]].name`. On the game side,
`input_hook.rpy` (generated map, parity-checked against the contract) turns each
name into its `renpy_events` — e.g. `a → dismiss`, `b → game_menu`,
`start → dismiss, button_select, bar_activate, bar_deactivate` — via
`renpy.queue_event()`. No X-level key injection is involved anywhere in the
shipping path.

### The global exit combo

Holding **Start** for 2 s emits a `HoldEvent` in the launcher (GPIO hold
detection on device, `hold:start` on the TCP/stdin dev transports). In-game,
that triggers `GameSession.request_exit()` — SIGTERM to the game's process
group, SIGKILL after 5 s — so the player can always get back to the library.

## The SPI panel driver

`runtime/src/spi_driver/` — a small C driver with a CFFI binding:

- **Data path:** `/dev/spidev0.0` (kernel spidev).
- **Control lines** via `libgpiod` (v1 API): DC 25, RST 17, BUSY 24 (pins from
  the generated `contract.h`).
- **API:** `open_panel()` → `init` / `full_refresh(frame)` /
  `partial_refresh(frame)` / `sleep` — the launcher's `SpiBackend` and the
  power-off path call these.
- Cross-compiled by the `inky-runtime` Buildroot package (with an aarch64
  object-format guard so a mis-wired cross build fails loudly).
- Three known **bring-up flip-points** to settle on real hardware: frame
  inversion (`EINKY_INVERT_FRAME`), gpiochip index (`EINKY_GPIOCHIP`), and BUSY
  polarity.

## Legacy / auxiliary paths

Kept in `runtime` but **not** in the shipping boot path:

| Path | Status |
|---|---|
| `inky-frame` (Xvfb root-window capture → dither → dispatch) | superseded by the launcher-owned pipeline; useful for standalone debugging |
| `inky-input` (gpiozero → `xdotool` keysym injection into X) | superseded — games get input over the socket; never needed for the launcher's own UI |
| `inky-eink-receiver` (standalone engine-capture receiver) | the launcher embeds an equivalent, stoppable receiver (`launcher/session/receiver.py`) |
| ESP32 dev bridge (`runtime/firmware/esp32`, TCP :5333/:5334 to a real spare panel) | retired bring-up artifact (ADR 0006) |
