---
sidebar_position: 1
---

# Boot & session

How the device goes from power-on to an interactive launcher, and what keeps
the session alive. Everything on this page is implemented and verified on the
QEMU emulator target; the Pi target ships the same stack (pending on-board
validation).

## The boot chain

```
power on
 │
 ├─ [Pi only] VideoCore GPU firmware
 │    reads /boot/config.txt  ← generated from meta/shared/hardware.toml:
 │    dtparam=spi=on, gpio pull-ups for the 7 buttons, 64-bit kernel
 │
 ├─ Linux kernel
 │    Pi:   raspberrypi/linux fork, bcm2711 defconfig, bcm2710-rpi-zero-2-w DTB
 │    QEMU: mainline 6.18.x, qemu aarch64 "virt" machine, virtio disk/net
 │
 ├─ BusyBox init  (SysV-style /etc/init.d/S* scripts; no systemd)
 │    …
 │    S95inky-session          ← the only einky-specific service
 │
 └─ /usr/bin/inky-session  (installed by package/inky-session)
      1. exports the game-spawn env (DISPLAY=:0, LIBGL_ALWAYS_SOFTWARE=1,
         SDL_AUDIODRIVER=dummy, RENPY_EINK_SOCKET, RENPY_INPUT_SOCKET)
      2. sources /etc/default/inky-session   ← per-target backend selection
      3. supervises `inky-launcher` in a restart loop (3 s backoff),
         logging to /var/log/launcher.log + /var/log/inky-session.log
```

There is **no shell, desktop, or display manager in the boot path**. Buildroot's
stock `S40xorg` autostart is deleted by `board/common/post-build.sh`; X (Xvfb)
is started on demand by the launcher, only while a game runs.

## Per-target configuration: `/etc/default/inky-session`

The launcher binary is identical on every target. Behaviour is selected by one
overlay file per board, sourced by the session supervisor:

| Variable | Pi (`board/inky/overlay`) | QEMU (`board/qemu/overlay`) | Meaning |
|---|---|---|---|
| `EINKY_DISPLAY_BACKEND` | `spi` | `tcp` | panel over SPI vs. frame stream on TCP :5333 |
| `EINKY_INPUT_SOURCE` | `gpio` | `tcp` | real buttons vs. ASCII names on TCP :5334 |
| `EINKY_SPI_DEV` | `/dev/spidev0.0` | — | panel device |
| `EINKY_GPIOCHIP` | `/dev/gpiochip0` | — | gpiochip character device (buttons via python-gpiod; also the C driver's DC/RST/BUSY) |
| `EINKY_GAMES_DIR` | `/opt/games` | `/opt/games` | where games are scanned |
| `EINKY_STATE_DIR` | `/var/lib/inky` | `/var/lib/inky` | settings, cover cache, game logs |
| `EINKY_ALLOW_POWER` | `1` | `1` | let the Power menu really halt/reboot |
| `EINKY_WIFI_BACKEND` | *(unset → real `wpa_cli`)* | `mock` | Wi-Fi UI backend |

The launcher's compiled-in defaults are **hardware-safe** (`spi`/`gpio`); the
emulator overlay flips them to `tcp`/`tcp`. On a dev workstation the launcher
`Makefile` sets the same variables for `make run-host`.

## The supervisor contract

`inky-session.sh` is deliberately tiny: *the launcher is the UI*, so the
supervisor has nothing to start besides it.

- **Crash resilience:** if `inky-launcher` exits for any reason it is restarted
  after 3 seconds — a crash must never wedge the box.
- **Environment for games:** the `RENPY_*`/`DISPLAY`/GL variables the supervisor
  exports are inherited by the launcher and then by every Ren'Py game it spawns.
  They are harmless while no game is running.
- **Service stop** (`/etc/init.d/S95inky-session stop`) kills, in order: the
  supervisor loop, the launcher, any running `renpy.py`, and Xvfb — so nothing
  is relaunched mid-teardown.

## Session lifecycle (launcher-owned)

Once `inky-launcher` is up it **owns the panel (SPI) and the buttons (GPIO) for
the whole uptime** (ADR 0009). The session states:

1. **Menu.** The launcher renders the game library / settings itself (Pillow,
   1-bit) and pushes frames to its display backend. Buttons drive the UI
   directly — no X, no GL, no engine.
2. **Game starting.** On *play*: render a "Starting…" screen immediately, bind
   the frame receiver on `/tmp/renpy-eink.sock`, ensure Xvfb `:0` is up
   (started once, then reused), spawn `python3 /opt/renpy/renpy.py
   /opt/games/<slug>` in its **own process group** with stdout/stderr to
   `/var/lib/inky/logs/<slug>.log`.
3. **In game.** The main loop only routes: game PNG frames → dither → panel
   (via the receiver thread); button presses → `/tmp/renpy-input.sock` → the
   game's `input_hook.rpy`; **holding Start for 2 s** asks the session to
   terminate the game (SIGTERM to the group, SIGKILL after 5 s).
4. **Game exit.** A watcher thread reports the exit code back to the main loop.
   Exit within 10 s of launch with a non-zero code is treated as a
   crash-on-startup and surfaces an error screen; otherwise the launcher simply
   returns to the library (full refresh).
5. **Power.** Halt/reboot from the Settings → Power screen puts the panel into
   deep sleep first (protects the e-ink), then calls `poweroff`/`reboot`
   (suppressed on dev hosts where `EINKY_ALLOW_POWER` is unset).

## Failure modes & how they're handled

Every row below is pinned by a test. The launcher tests
(`launcher/tests/integration/`) drive the real session code with the scriptable
`fake_game.py` and a `PngBackend`; the one system-level row is exercised by the
[A1 emulator test](./inkyos-build.md#automated-acceptance-test).

| Failure | Behaviour | Test |
|---|---|---|
| Launcher process killed (crash) | supervisor relaunches it in 3 s; a fresh frame reaches the panel | A1 `supervisor-restart` stage (`kill -9` over serial) |
| Game fails to spawn (bad interpreter) | partial session torn down; "Could not start the game" screen | `test_session.py::test_spawn_failure_shows_error_screen` |
| `Xvfb` won't start | start aborts; receiver stopped **and its socket unlinked**; "Could not start the game" screen | `test_session_faults.py::test_ensure_xvfb_failure_shows_error_and_unlinks_socket` |
| Game crashes on launch (rc ≠ 0 within 10 s) | fast-exit detection → "The game exited unexpectedly" screen | `test_session_faults.py::test_fast_nonzero_crash_shows_error_screen` |
| Game exits cleanly (**rc == 0**, however fast) | return to the library **silently** — "fast" only means "crash" when rc ≠ 0 | `test_session_faults.py::test_clean_fast_exit_returns_silently` |
| Game killed mid-frame (SIGKILL / external) | `GameExitEvent` → session torn down, input/eink socket unlinked, library re-rendered (full refresh) | `test_session_faults.py::test_sigkill_midframe_tears_down_and_returns_to_library` |
| Game's input socket not yet listening | each press is one connect attempt that fails quietly and resets for the next — no exception, no reconnect spin | `test_session_faults.py::test_input_socket_absent_presses_dropped_silently` |
| Garbage (non-PNG) frame body | frame dropped; connection **kept**; the next valid frame still displays | `test_session_faults.py::test_garbage_frame_dropped_receiver_survives` |
| Oversized (> 8 MiB) length header | connection dropped; receiver re-accepts and displays the next valid frame | `test_session_faults.py::test_oversized_header_drops_connection_receiver_reaccepts` |
| Frame PNG not 800×480 | **scaled** to the panel (shared `to_panel_grey` resize) — never dropped or mis-sized downstream | `test_session_faults.py::test_wrong_dimension_png_is_scaled_to_panel` |
| Display backend `.show()` errors mid-session | frame dropped, receiver keeps serving; `TcpBackend` silently drops frames when the preview client is absent/vanished | `test_session_faults.py::test_receiver_survives_backend_show_oserror`, `test_tcp_backend_drops_frames_with_no_client` |
| Rapid relaunch (launch → exit → launch) | receiver rebinds cleanly (no "address already in use"); a fresh receiver thread, no crossed threads | `test_session_faults.py::test_rapid_relaunch_reuses_socket_cleanly` |
| Player mashes keys at a list boundary | screens report "nothing changed" and the render is skipped — no pointless e-ink flashing | `test_navigation.py::test_boundary_press_is_noop` |

Two behaviours were **defined** here (previously undefined in code):

- **Wrong-dimension frames are scaled**, not letterboxed or dropped: the game
  renders at 1280×720 and the panel is 800×480, so the pipeline already resizes
  every frame through `to_panel_grey`; a game that emits any other size gets the
  same treatment rather than a mis-sized packed buffer.
- **A display-backend error never kills the session**: the frame receiver
  swallows an `OSError` from `backend.show()` and keeps serving, so a preview
  client that vanishes (or a transient SPI glitch) can't freeze the panel for the
  rest of the game.

## What's on the image (per package)

| Buildroot package | Installs | Role |
|---|---|---|
| `renpy` | `/opt/renpy` (engine built from source, one e-ink patch) | runs games |
| `inky-runtime` | `frame_processor`, `input`, `spi_driver` site-packages + `inky-frame` / `inky-input` / `inky-eink-receiver` scripts; the CFFI `_spi_driver` C extension on the Pi target | shared pipeline library (the launcher imports it) |
| `inky-launcher` | `launcher` site-package + the `inky-launcher` script | the boot UI + session manager |
| `inky-session` | `/usr/bin/inky-session`, `/etc/init.d/S95inky-session` | boot service + supervisor |
| `board/common/post-build.sh` | `/opt/games/the_question` (stock game + the two hook files + e-ink gui/options + `inky-manifest.toml`) | the bundled test-fixture game |

> The standalone `inky-frame` / `inky-input` / `inky-eink-receiver` console
> scripts are still installed and useful for debugging, but they are **not** in
> the boot path — since ADR 0009 the launcher performs those roles in-process.
