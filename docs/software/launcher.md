---
sidebar_position: 3
---

# Launcher internals

`launcher/` (package **`einky-launcher`**, entry point `inky-launcher`) is the
application the device boots into: game library, system settings, and the game
session manager. It is a pure-Python app — Pillow for rendering, `einky-runtime`
for everything hardware-shaped, no engine, no GPU, no X for its own UI
([ADR 0009](https://github.com/einky/meta/blob/main/adr/0009-native-python-launcher.md)).

## Module map

```
launcher/
├── main.py            console entry point: config → backend → App.run()
├── config.py          AppConfig.from_env() — every knob is an EINKY_* env var
├── app.py             the main loop (one event queue, menu vs in-game modes)
├── events.py          ButtonEvent / HoldEvent / GameExitEvent / Redraw / Quit
├── display/
│   ├── render.py      Canvas: Pillow "L" compositing → threshold → mode "1" → pack
│   ├── refresh.py     RefreshPolicy: partial vs full decisions
│   └── backend.py     SpiBackend | TcpBackend | PngBackend (protocol DisplayBackend)
├── buttons/
│   └── sources.py     GpioSource | TcpSource | StdinSource → event queue
├── ui/
│   ├── core.py        Screen protocol, Navigator (screen stack), Command types
│   ├── widgets.py     ListView, Dialog, StatusBar, Footer
│   ├── keyboard.py    d-pad-driven on-screen keyboard (Wi-Fi passphrase)
│   └── theme.py       1-bit look: fonts, spacing, black/white only
├── screens/
│   ├── library.py     home screen: game list + focused cover, A=play Start=settings
│   ├── settings_menu.py / display_settings.py / wifi.py / power.py
│   └── game.py        StartingScreen, GameErrorScreen
├── games/
│   ├── library.py     scan EINKY_GAMES_DIR → ordered [Game] (last-played first)
│   ├── manifest.py    optional per-game inky-manifest.toml (title/author/sort_key)
│   └── covers.py      cover image discovery + dithered cover cache
├── session/
│   ├── game_session.py  GameSession: the launcher↔game bridge (below)
│   ├── process.py       spawn_group / terminate_group / ensure_xvfb
│   └── receiver.py      GameFrameReceiver: PNG socket → dither → backend
└── settings/
    ├── store.py       SettingsStore: JSON at $EINKY_STATE_DIR/settings.json
    ├── wifi.py        WpaCliBackend | NullBackend (no wlan0) | MockBackend
    └── power.py       halt / reboot (gated by EINKY_ALLOW_POWER)
```

## The main loop

One thread drains one `queue.Queue` of events; input sources and the game
watcher feed it from their own threads. Two modes:

- **Menu mode** — the top screen of the `Navigator` stack handles each event
  and returns an `Outcome`: *dirty?* (re-render), *full refresh?*, and
  optionally a `Command` (`Push`/`Pop`/`Replace` a screen, `LaunchGame`,
  `ApplySettings`, `PowerAction`, `Quit`). If nothing changed, nothing is
  rendered — idle key-mashing never flashes the panel.
- **In-game mode** — while a `GameSession` exists the loop only routes:
  `ButtonEvent` → forward to the game, `HoldEvent(start)` → request exit,
  `GameExitEvent` → tear down and return to the library.

Rendering is always: screen draws on a fresh `Canvas` → `RefreshPolicy.decide`
→ `backend.show(packed_bytes, full=…)`.

## Game session lifecycle (the IPC that matters)

`GameSession.start()`, in order:

1. **Frame receiver up first** — bind `/tmp/renpy-eink.sock` before the game
   exists, so the game's first connect attempt succeeds.
2. **Xvfb on demand** — `ensure_xvfb(":0")`: started once, reused across games
   (games need an X display + software GL; the launcher itself doesn't).
3. **Spawn** — `python3 /opt/renpy/renpy.py /opt/games/<slug>` in a **new
   process group**, env `DISPLAY=:0 LIBGL_ALWAYS_SOFTWARE=1
   SDL_AUDIODRIVER=dummy RENPY_EINK_SOCKET=… RENPY_INPUT_SOCKET=…`, output to
   `$EINKY_STATE_DIR/logs/<slug>.log`. (Binary/paths overridable:
   `EINKY_PYTHON`, `EINKY_RENPY`, `EINKY_SPAWN_XVFB`, `EINKY_XVFB_DISPLAY`.)
4. **Watch** — a daemon thread `wait()`s on the process and posts
   `GameExitEvent(returncode, fast=…)`; *fast* = exited within 10 s, which
   combined with rc ≠ 0 is presented as "The game exited unexpectedly".
5. **Forward input** — button names over the input socket; failures are
   tolerated silently (Ren'Py may still be booting) and the connection is reset
   for the next press.
6. **Stop** — idempotent: SIGTERM the group (SIGKILL after 5 s), stop the
   receiver thread, close the input sender, unlink the socket.

The launcher writes `last_played` into the settings store on every successful
launch, and the library hoists that game to the top of the list.

## Configuration reference

All environment, read once at startup (`config.py`); set by
`/etc/default/inky-session` on device and by the `Makefile` on a workstation:

| Var | Default | Meaning |
|---|---|---|
| `EINKY_DISPLAY_BACKEND` | `spi` | `spi` \| `tcp` \| `png` |
| `EINKY_INPUT_SOURCE` | `gpio` | `gpio` \| `tcp` \| `stdin` |
| `EINKY_GAMES_DIR` | `/opt/games` | game scan root |
| `EINKY_STATE_DIR` | `/var/lib/inky` | settings.json, cover cache, game logs |
| `EINKY_FRAME_TCP_HOST/PORT` | `0.0.0.0` / `5333` | TcpBackend bind |
| `EINKY_INPUT_TCP_HOST/PORT` | `0.0.0.0` / `5334` | TcpSource bind |
| `EINKY_SPI_DEV` | `/dev/spidev0.0` | panel device |
| `EINKY_PNG_DIR` | `$EINKY_STATE_DIR/frames` | PngBackend output |
| `EINKY_FULL_REFRESH_EVERY` | `30` (contract) | ghost-clearing cadence |
| `EINKY_ALLOW_POWER` | `0` | let Power really halt/reboot |
| `EINKY_WIFI_BACKEND` | auto | `mock` forces canned networks |
| `EINKY_PYTHON` / `EINKY_RENPY` | `python3` / `/opt/renpy/renpy.py` | game spawn command |
| `EINKY_SPAWN_XVFB` / `EINKY_XVFB_DISPLAY` | `1` / `:0` | Xvfb management |
| `EINKY_FONT_PATH` | — | explicit TTF override |
| `EINKY_LOG_LEVEL` | `INFO` | logging |

## Settings subsystem

- **Store:** flat JSON at `$EINKY_STATE_DIR/settings.json`
  (`full_refresh_every`, `last_played`, Wi-Fi bits); written atomically, applied
  live (`ApplySettings` rebuilds the `RefreshPolicy`).
- **Display:** tune `full_refresh_every` from the UI.
- **Wi-Fi:** scan/join via `wpa_cli` + `udhcpc` on device (`WpaCliBackend`);
  `NullBackend` when no `wlan0` exists (QEMU shows "Wi-Fi unavailable" unless
  `EINKY_WIFI_BACKEND=mock` provides canned networks). Passphrase entry uses the
  d-pad on-screen keyboard (B = backspace, Start = submit).
- **Power:** halt / reboot with a confirm dialog; the panel is put to deep
  sleep first.

## Development without hardware

```sh
make setup       # venv + editable install of ../runtime and this repo
make run-host    # launcher with tcp backends, scanning ../games
make preview     # Tk window rendering the 1-bit frames (tools/dev_preview.py)
make send-input  # arrows/wasd, j=a, k=b, Enter=start, h=hold-start
make test        # unit + integration (uses PngBackend / fake game)
```

The integration tests drive the real code paths with a scripted fake game
(`tests/integration/fake_game.py`) — session launch/exit, navigation, settings
persistence, and the Wi-Fi flow — all headless. `test_pack_parity.py` pins the
launcher's Pillow packing to the runtime `pack_1bit` output byte-for-byte.

## Verified vs pending

Milestones **M0–M4** (UI, library, session bridge, settings + persistence,
Wi-Fi flow on mock) are implemented and verified on the QEMU image — including
launching and exiting the real bundled game. **M5 = hardware bring-up**: the
`spi`/`gpio` backends, panel refresh tuning, and real Wi-Fi association are
code-complete but unvalidated on a physical board.
