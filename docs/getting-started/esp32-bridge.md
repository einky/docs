---
sidebar_position: 4
---

# ESP-32 bridge dev test

A third dev path, alongside the socket viewer and the on-Pi SPI driver: render the launcher (or any Ren'Py game) into Xvfb on your laptop, then push frames over WiFi to an ESP-32 that drives a Waveshare 7.5" e-ink panel. Buttons wired to the ESP feed input back to the host as synthetic key events. Useful when you want to see a real panel update — and drive it with real buttons — without flashing an SD card and booting the Pi.

```
Ren'Py SDK ──► Xvfb (:93) ──► einky_bridge.py ──POST /frame  ──► ESP-32 ──SPI──► 7.5" e-ink
   (host)         (host)            (host)    ──POST /partial──►  WiFi    (firmware)
       ▲                              │
       │                              │ GET /input  (poll)
       │                              ▼
   xdotool ◄──────────── synthetic keys ◄──── button events ◄──── 5 GPIO buttons
```

## How it works

- **Xvfb** gives Ren'Py a headless 800×480 framebuffer at the panel's native size.
- **`launcher/bridge/einky_bridge.py`** screen-grabs that framebuffer with `mss`, fits it to 800×480, Floyd–Steinberg dithers to 1 bit, packs it MSB-first (48000 bytes) and POSTs it. It hashes each frame with blake2b and only sends when the hash changes — the e-ink panel can't sustain high refresh rates, so this also rate-limits naturally. For each new frame the bridge XORs against the previous one to find the changed bounding box and chooses between `POST /frame` (full refresh) and `POST /partial` (fast, ghosting-prone). A background thread polls `GET /input` every 50 ms and replays each queued button name as a key into the same `DISPLAY` via `xdotool`.
- **`launcher/bridge/esp32/einky_esp32.ino`** runs an `ESPAsyncWebServer` on port 80. `POST /frame` accepts 48000 bytes and triggers a full refresh via `GxEPD2`. `POST /partial` accepts an `X-Region: x,y,w,h` header plus `(w*h)/8` bytes and triggers a partial refresh inside that window. `GET /test` redraws the boot self-test pattern. `GET /input` returns and clears the queued button events (one name per line). The bit convention is `1 = black, 0 = white` (the bridge inverts PIL's default to match `GxEPD2::drawBitmap`).

## Partial refresh

Partial refresh redraws only a rectangular sub-region of the panel, taking ~300–500 ms instead of the ~1.5 s of a full refresh. The bridge picks the mode automatically:

1. XOR the new packed frame against the last one pushed.
2. Compute the bounding box of changed bytes; snap `x` and `w` outward to the nearest 8-pixel boundary (the panel addresses pixels in 8-bit columns).
3. If the bbox area exceeds `PARTIAL_AREA_THRESHOLD` (default 40% of the panel) **or** more than `FULL_REFRESH_EVERY` partials (default 15) have happened in a row, send `POST /frame`. Otherwise send `POST /partial` with just the patch bytes.

The "every N partials" cap exists because partial refresh ghosts — each update leaves faint traces of the previous content, and they accumulate. A periodic full refresh clears them. Lower `FULL_REFRESH_EVERY` for cleaner output, raise it for faster responsiveness.

:::note Floyd–Steinberg caveat
`to_epd_bytes` uses Floyd–Steinberg dithering, which propagates quantization error rightward and downward. Tiny visible changes can ripple into a much larger bbox — a one-character text edit in a textbox often dirties the rest of that row to the right. This is why the default `PARTIAL_AREA_THRESHOLD` is fairly permissive (0.40); tighten it to 0.20 if you'd rather see fewer false-positive partials at the cost of more full refreshes.
:::

## Button wiring

Five momentary buttons, each between a GPIO and GND. The firmware enables `INPUT_PULLUP`, debounces with a 30 ms window, and queues a press event on each HIGH→LOW transition.

| Button | GPIO | Key sent on host |
|--------|------|------------------|
| left   | 25   | `Left`           |
| up     | 32   | `Up`             |
| down   | 33   | `Down`           |
| right  | 26   | `Right`          |
| enter  | 12   | `Return`         |
| esc    | 14   | `Escape`         |

:::warning GPIO 12 is a strapping pin
At reset, GPIO 12 selects the internal flash voltage — it must read LOW. A button-to-GND wired with no external pull-up is fine (the released button leaves the pin floating, but most boards have a sufficient external/parasitic pull-down for boot). If the ESP fails to boot intermittently, swap `enter` to a non-strapping pin (e.g. 27) and update `BTN_ENTER` in the firmware.
:::

## Prerequisites

On the host:

```bash
pip install mss numpy requests pillow
sudo apt install xvfb xdotool
```

`xdotool` is what the bridge uses to inject button presses into Xvfb. If it's missing, frame push still works but the bridge logs `xdotool not found; input forwarding disabled`.

On the ESP-32 (Arduino IDE / arduino-cli, install via Library Manager):

- **GxEPD2** (Jean-Marc Zingg)
- **ESP Async WebServer** (ESP32Async)
- **Async TCP** (ESP32Async)

Edit `launcher/bridge/esp32/einky_esp32.ino` and set `WIFI_SSID` / `WIFI_PASS` for your network, then flash. On boot the ESP draws a two-quadrant test pattern, joins WiFi, and prints its IP over serial at 115200 baud — you'll need that IP for `ESP_URL`.

Wiring is documented in the `.ino` header (default pins: `CS=5, DC=17, RST=16, BUSY=4, PWR=13`).

## Running

Two shells. **Shell 1** — Xvfb + Ren'Py:

```bash
Xvfb :93 -screen 0 800x480x24 &
DISPLAY=:93 ./renpy-8.5.2-sdk/renpy.sh ./../games/the_question &
```

Swap `the_question` for any Ren'Py project (e.g. `./launcher/launcher` for the boot menu).

**Shell 2** — bridge:

```bash
DISPLAY=:93 ESP_URL=http://10.39.83.254/frame python3 bridge/einky_bridge.py
```

Replace the IP with whatever your ESP-32 printed on its serial console. The bridge logs `pushed 48000B` each time it sends a new frame and silently skips duplicates.

`dev-launch.sh` automates the Xvfb-plus-launcher half of this on display `:99` and prints the matching bridge invocation — use it if you don't need a custom display number or game path.

## Configuration

The bridge reads two env vars:

| Var | Default | Purpose |
|-----|---------|---------|
| `ESP_URL` | `http://192.168.1.50/frame` | Where to POST full frames. The bridge derives `/partial` and `/input` from the same host. |
| `POLL_S` | `0.5` | Seconds between display grabs. |
| `INPUT_POLL_S` | `0.05` | Seconds between button-event polls. Lower = snappier input, more WiFi traffic. |
| `DISPLAY` | `:0` | Target X display for `xdotool` key injection (must match the Xvfb display Ren'Py runs on). |
| `PARTIAL_AREA_THRESHOLD` | `0.40` | Max changed-area fraction (of full panel) that still goes via `/partial`. Anything larger forces a full refresh. |
| `FULL_REFRESH_EVERY` | `15` | Force a full refresh after this many consecutive partials, to clear ghosting. |

Lowering `POLL_S` makes input feel snappier but won't actually push faster than the panel can refresh (the dedup hash absorbs idle frames either way).

## Troubleshooting

- **`grab failed`** — Xvfb isn't running on the `DISPLAY` you set, or `mss` can't reach it. Verify with `DISPLAY=:93 xdpyinfo`.
- **`push failed: ConnectionError`** — ESP isn't reachable. Check it's on the same subnet (`ping <esp-ip>`); the firmware uses station mode, so the ESP and host must share an AP.
- **`incomplete` 400 from the ESP** — body length didn't match the expected size (`FRAME_BYTES` for `/frame`, `(w*h)/8` for `/partial`). For full frames it's almost always a `PANEL_W`/`PANEL_H` mismatch versus the firmware's panel driver. For partials, check the `X-Region` header parses (`x,y,w,h`) and that `x` and `w` are multiples of 8.
- **Visible ghosting builds up over time** — `FULL_REFRESH_EVERY` is too high for your content, or the panel needs a longer recovery between updates. Lower it to ~5–8 for text-heavy scenes.
- **Partial refresh draws garbage in the patched region** — bbox or patch bytes are out of sync. The firmware logs `partial: x=… y=… w=… h=… (NB)` on render; cross-check those numbers against the bridge's `pushed partial …` line. A mismatched `PANEL_H` between the two sides is the most common cause.
- **Test pattern visible on boot, but pushed frames don't render** — usually `BUSY` or `PWR` wiring; the firmware logs `BUSY` state at boot and around each render. Hit `GET /test` to confirm the SPI path still works.
- **Buttons don't move the cursor** — confirm presses arrive at the ESP (firmware logs `btn: <name>` over serial), then confirm the bridge logs `key: <name>`. If both happen but Ren'Py ignores them, `DISPLAY` in the bridge's environment doesn't match the Xvfb display Ren'Py is actually attached to. Test injection manually with `xdotool key --display :93 Return`.
- **Repeated/double presses on every press** — debounce window too short for your switches; bump `DEBOUNCE_MS` in the firmware (default 30 ms).
- **ESP boots intermittently or hangs at reset** — the `enter` button on GPIO 12 is the prime suspect (see the strapping-pin warning above).
- **WSL note** — if the bridge can reach the ESP but the ESP can't reach the bridge (not needed here, but for future debugging), WSL2's NAT is the culprit. The bridge → ESP direction is unaffected because the host originates the connection.
