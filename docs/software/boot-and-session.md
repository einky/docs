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
| `GPIOZERO_PIN_FACTORY` | `rpigpio` | — | gpiozero backend (lgpio is not packaged in Buildroot) |
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

| Failure | Behaviour |
|---|---|
| Launcher crashes | supervisor restarts it in 3 s; panel re-initialised |
| Game fails to spawn | partial session torn down; "Could not start the game" screen |
| Game crashes right after launch | fast-exit detection → "The game exited unexpectedly" screen |
| Game's input socket not yet listening | send fails quietly and reconnects on the next press (Ren'Py may still be booting) |
| Bad/oversized PNG frame from a game | frame dropped (or connection dropped for a bad length); pipeline keeps running |
| Player mashes keys at a list boundary | screens report "nothing changed" and the render is skipped — no pointless e-ink flashing |

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
