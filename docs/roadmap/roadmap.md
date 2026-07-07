---
sidebar_position: 1
---

# Roadmap to a plug-and-play console

**The goal:** a user flashes an SD card, plugs it in, powers on, lands in the
launcher within a reasonable boot time, and plays games — with settings and
saves surviving reboots and reflashes. No keyboard, no serial cable, no manual
steps. The product surface is defined by the feature set **F1–F13** below.

**Where we are (2026-07-07):** the entire software stack is implemented and
verified on the QEMU emulator — boot → launcher → launch/exit a real Ren'Py
game → settings persistence → mock Wi-Fi ([Integration status](../architecture/integration-status)).
The two structural gaps are: (a) nothing has ever run on a physical board, and
(b) the "content" story (real games, sideloading, save durability) is a
fixture-only placeholder.

**Ordering principle:** no physical hardware is available right now, so every
step that can be built and validated in software (QEMU, host runs, CI) comes
first, ordered so each step de-risks or unblocks the ones after it. Hardware
bring-up is a self-contained checklist that starts the day a board exists —
and everything before it is designed to make that day short.

> Each step below has a ready-to-use agent brief in
> [Agent prompts](./agent-prompts.md). Display-touching steps must follow the
> [E-ink playbook](../software/eink-playbook.md) — the project's refresh,
> ghosting, and dithering rules.

---

## Feature coverage (F1–F13)

Where each product feature stands, and which roadmap step owns it. "Delivered"
means implemented and emulator-verified; every delivered feature still gets
locked in by the Phase A regression tests.

| ID | Feature | Status | Owning step(s) |
|----|---------|--------|----------------|
| F1 | System Boot | **Delivered** — BusyBox init → `inky-session` → launcher, no manual steps | A1 (regression-gate), B3 (splash + boot time) |
| F2 | Library Navigation | **Delivered** — library screen scans `/opt/games`, manifests + covers | A1; C2 adds a second title to make it real |
| F3 | Start Game | **Delivered** — `GameSession` spawns Ren'Py under Xvfb | A1, A3 (failure paths) |
| F4 | In-Game Menu | **Partial** — B button queues `game_menu`; the stock Ren'Py menu GUI is not e-ink-friendly beyond the bundled fixture's overrides | D3 |
| F5 | Save/Load System | **Partial** — Ren'Py saves work but land on the root filesystem (`HOME=/root`), so they don't survive a reflash | B1, B2, B4 (no-RTC save ordering) |
| F6 | Settings Menu | **Partial** — refresh cadence, Wi-Fi, power exist; font size missing; *brightness and volume do not apply to this hardware* (no backlight, no audio path) — e-ink equivalents instead | D2 |
| F7 | Shutdown | **Delivered** — Power screen halts/reboots with panel deep-sleep first; *data integrity* needs the read-only root | B1, B4 |
| F8 | Read & Play | **Delivered mechanically; quality work remains** — engine renders under Xvfb; PNG → dither → panel pipeline works, but frame dedup, dither stability, and refresh-policy v2 (the [playbook](../software/eink-playbook.md) rules) are not implemented | A1, D1 |
| F9 | Choice Handling | **Delivered** — buttons → launcher → input socket → `renpy_events` (focus/dismiss) | A1 |
| F10 | Resume Game (Pop Mode) | **Partial** — Ren'Py's menu returns to the exact interaction; needs explicit verification + e-ink GUI polish | D3 |
| F11 | View Battery Status | **Missing** — no fuel gauge in the BOM today (IP5306 planned, no telemetry); needs a software abstraction now, a hardware decision later | D5 (UI + mock), E/F (real readings) |
| F12 | Crash Recovery | **Partial** — launcher crash → supervisor restart, game crash → error screen; *game-progress* recovery (autosave + continue) not wired; no watchdog for a hung (not crashed) UI | A3, B2, B4 |
| F13 | Sleep Mode | **Missing** — no inactivity handling; panel deep-sleep exists only at power-off | D4 |

---

## Phase A — Lock in what works (regression safety)

*Everything verified so far was verified by hand. Before adding features, make
the emulator verification automatic and cheap, so nothing silently regresses
under the changes in Phases B–E. This is what keeps F1/F2/F3/F8/F9 delivered.*

### A1. Scripted end-to-end emulator acceptance test

A single script (host-side, no interaction) that: boots the QEMU image, waits
for the launcher's first frame on :5333, asserts it against a golden 1-bit
frame, drives a scripted button sequence over :5334 (navigate → launch
`the_question` → advance dialogue → hold-Start → back to library → reboot via
Settings → launcher up again), asserting a golden or invariant at each step.

- **Validated:** QEMU only. **Repo:** `buildroot_os` (script) + `launcher/tools` (reuse the TCP clients).
- **Done when:** one command returns pass/fail in minutes and catches a broken
  boot, pipeline, or session bridge.

### A2. Cross-repo CI pipeline

Per-repo jobs already exist conceptually (pytest, ruff/mypy, contract parity,
golden dithers); wire them into org CI, then add the expensive job: build the
QEMU image (cached Buildroot `.ccache`/`.dl`) and run A1 on it. Include the
`gen_hardware.py --check` / `make gen-check` parity gates and the
`versions.env` ↔ Buildroot pin parity check.

- **Validated:** CI runners, no hardware.
- **Done when:** a PR in `runtime`, `launcher`, or `buildroot_os` cannot merge
  if it breaks the emulator boot or the shared contract.

### A3. Fault-injection tests for the session layer *(F3, F12)*

Host-level integration tests (extend `launcher/tests/integration/`) for the
ugly paths: game killed mid-frame, receiver fed garbage/oversized PNGs, input
socket never comes up, Xvfb dies mid-game, launcher crash → supervisor restart
(emulator: `kill` the launcher over serial and assert the UI comes back).

- **Done when:** every row of the failure-mode table in
  [Boot & session](../software/boot-and-session#failure-modes--how-theyre-handled)
  has a test.

## Phase B — Durability & appliance hardening (all QEMU-testable)

*A console must survive power cuts and keep saves (F5, F7, F12). This is pure
OS/config work, fully exercisable in emulation, and it changes the partition
layout — do it before the content work in Phase C depends on that layout.*

### B1. Split a writable data partition; make the rootfs read-only *(F5, F7)*

Add a second partition (`/data`) to both targets' images holding
`EINKY_STATE_DIR` (settings, covers, logs) and `/opt/games`; mount the rootfs
read-only. Update `genimage.cfg` (Pi) and the QEMU disk image accordingly;
first boot expands/creates the data filesystem.

- **Validated:** QEMU (same genimage mechanics as the Pi image).
- **Done when:** the A1 test passes with a read-only root; settings + games
  live on `/data`; `qemu-system` hard-killed mid-write boots clean (fsck or
  journal recovery automatic).

### B2. Durable game saves, autosave & crash recovery *(F5, F12)*

Games run with `HOME=/root` today, so engine saves/persistent data land in the
root filesystem and die with it. Point each game session's save location
(`HOME` or Ren'Py's save-directory mechanism) at `/data/saves/<slug>/` from
`GameSession`'s environment. Then wire **crash recovery for game progress**:
ensure Ren'Py autosave is active (per-game `options.rpy` template setting),
and verify that after a simulated power cut mid-game the player can resume
from the autosave slot (engine "Continue"/auto-load path).

- **Validated:** QEMU + host (save → reboot → load; SIGKILL mid-game → relaunch → continue).
- **Done when:** a save survives reboot and a rootfs reflash, and a hard kill
  mid-game loses at most the last few interactions.

### B3. Boot-time budget and splash *(F1)*

Measure boot-to-launcher time in QEMU (relative numbers still guide: kernel
quieting, init ordering, deferring non-essentials). Ship an instant visual:
either a kernel/logo splash or — better fit — have `inky-session` push a
static 1-bit "einky" frame to the panel before the launcher finishes starting.

- **Validated:** QEMU (timing + preview shows the splash frame).
- **Done when:** something appears on the panel path < 2 s after init starts,
  and boot-to-interactive time is tracked in CI output.

### B4. Platform health: clock, memory, storage wear, watchdog *(F5, F7, F12)*

The invisible appliance work that decides whether the device survives months
of real use:

- **No RTC on the Pi Zero 2 W** — the clock starts at epoch every boot until
  NTP (which needs Wi-Fi). Ship a `fake-hwclock` (persist time to `/data`
  periodically + at shutdown, restore at boot), run `ntpd` opportunistically,
  and make **nothing correctness-critical depend on wall-clock time** — in
  particular "newest autosave" must use sequence numbers/slot metadata, never
  mtimes.
- **Memory budget** — 512 MB shared with llvmpipe. Measure RSS of the full
  stack in QEMU (`-m 512` kept deliberately), set `LP_NUM_THREADS` and Ren'Py
  `config.image_cache_size` defaults, add zram swap as a safety valve, and
  assert in A1 that a game session stays under a threshold.
- **SD wear & write hygiene** — `noatime`, sane commit interval on `/data`;
  debounce settings writes (never write per-keypress); size-capped rotating
  logs on `/data` (a chatty log on flash is a slow-motion device killer).
- **Watchdog** — a hung (not crashed) launcher currently bricks the session;
  the supervisor only handles exits. Add a heartbeat (launcher touches a file
  / systemd-style ping) with the supervisor or BusyBox `watchdog` restarting
  on stall.

- **Validated:** QEMU (clock persistence across reboots, OOM behaviour, log
  rotation, watchdog recovery from a SIGSTOPped launcher).
- **Done when:** reboots keep monotonic-ish time without network, a memory
  ceiling is enforced and CI-tracked, logs can't fill `/data`, and a frozen
  launcher recovers automatically.

## Phase C — The content story (games as a product surface)

*Turn "a build-time test fixture" into "a library you can grow" (F2, F3). All
host/QEMU work.*

### C1. Decide and document the game-packaging convention (ADR)

One ADR settling: directory layout under `/opt/games` (→ `/data/games`),
`inky-manifest.toml` schema v1 (title/author/sort_key/cover + engine version),
and **how the two hook files get into games** — recommended: the launcher (or a
build step) injects/updates `eink_hook.rpy` + the generated `input_hook.rpy`
into a game's `game/` dir at install time, instead of hand-patching each game.
Delete the `games/launcher` cruft; seed the `games` repo with the convention.

- **Done when:** the ADR is accepted and `the_question` on the image is
  assembled *by the documented convention*, not by a special case.

### C2. e-ink game template + a second real title *(F2, F8, F9)*

Create `games/template-eink/`: a minimal Ren'Py project pre-configured for the
panel (800×480, high-contrast 1-bit-friendly GUI, hooks, manifest, autosave
settings from B2, e-ink game-menu screens shared with D3) — then a small
original game (even a short demo VN) built from it. Two entries in the library
validates ordering, covers, manifests, and per-game logs for real.

- **Validated:** host `run-host` + QEMU image with both games.
- **Done when:** the library shows and plays two differently-authored games.

### C3. Sideloading

Simplest robust path first: games live on the `/data` partition, so **mounting
the SD card's data partition on a PC and dropping a folder in** must just work
(document it), including a launcher "rescan" (automatic on library enter).
USB-gadget mass-storage mode (Zero 2 W supports USB OTG) is the stretch goal —
prototype the gadget config in QEMU where possible, validate at hardware time.

- **Done when:** adding/removing a game folder on `/data` changes the library
  on next visit, with no image rebuild.

## Phase D — Player-facing system features (F4, F6, F8, F10, F11, F13)

*The remaining product features. All are launcher/game-side software with mock
backends where hardware is involved, so all are buildable and testable on the
emulator now. Every step in this phase follows the
[E-ink playbook](../software/eink-playbook.md).*

### D1. Refresh & image-quality engine *(F8 — the e-ink core)*

Implement the playbook's decision table as code — today's `RefreshPolicy` is a
naive counter and the pipeline has three known quality gaps:

- **Frame dedup:** hash the packed frame; byte-identical frames are never
  pushed (no SPI, no refresh, no ghost-budget spend).
- **Refresh policy v2:** full refresh on screen/scene transitions, game
  start/exit, wake, and when the frame-diff exceeds a changed-pixel threshold
  (~40 %, tunable); partial otherwise; ghost budget counts *partials shown*;
  a "Clear screen" action in Settings.
- **Dither stability:** add ordered/blue-noise dithering alongside
  Floyd–Steinberg in `runtime` (FS's whole-frame noise reshuffle defeats
  dedup and sparkles under partial refresh — see the playbook); default game
  frames to ordered, keep threshold for UI, select per game via
  `inky-manifest.toml` and globally via Settings.
- **Rate limiting:** the receiver shows the *newest* frame when the panel is
  ready and drops intermediates — never queues (an animating game must not
  build up latency).

- **Validated:** host + QEMU (goldens for each dither; a diff-locality test —
  1-pixel input change ⇒ localized output change under ordered dithering;
  dedup and policy unit tests; an emulator scenario with an animating fake
  game asserting drops, not queueing).
- **Done when:** the playbook's decision table is enforced by tests, and the
  pack-parity/golden suites pin the new algorithms.

### D2. Settings expansion *(F6)*

Grow Settings beyond refresh/Wi-Fi/power, staying honest about the hardware:

- **Font size** — a launcher-wide text-scale setting (theme reads it from the
  `SettingsStore`), plus a per-game text-size override passed to games via the
  template's `gui.rpy` (C2).
- **Display tuning** — expose the existing `full_refresh_every` plus the D1
  dither-algorithm choice and a contrast/threshold option, and the "Clear
  screen" (force full refresh) action.
- **About page** — image version, storage usage, IP address when Wi-Fi is up.
- **Brightness / volume:** *not applicable* — the panel has no backlight and
  the device no audio output. Record this explicitly (one line in an ADR or
  the settings doc) so the feature list stays reconciled; revisit only if the
  case design adds a frontlight or speaker.

- **Done when:** settings render at three font scales, persist across reboot
  (extends the existing settings integration test), and the docs' launcher
  page reflects the new pages.

### D3. In-game menu & exact resume on e-ink *(F4, F10)*

The engine already provides the mechanism (B → `game_menu`; closing the menu
returns to the exact interaction — "pop mode"). Make it a product feature:

- e-ink-friendly **game menu screens** (save / load / settings / quit —
  high-contrast, no transparency/animation, d-pad navigable) in the C2
  template and layered onto bundled games.
- **Quit to library** from the in-game menu (clean `renpy.quit()` → the
  session's exit path) as the polite alternative to hold-Start.
- **Resume verification:** an integration test that opens the menu mid-scene,
  saves, quits, relaunches, loads, and asserts the same scene/interaction.

- **Done when:** the full save → quit → relaunch → load → exact-resume loop
  passes on the emulator using only the seven buttons.

### D4. Sleep mode *(F13)*

An inactivity state machine in the launcher (which owns the panel and buttons,
so it is the right owner):

- After N minutes without input (setting, default ~5): render a "sleeping"
  frame, put the panel into **deep sleep** (`spi_driver.sleep`), pause frame
  pushing; any button wakes it (re-`init` the panel, full refresh). e-ink holds
  the last image at zero power, which this exploits.
- In-game: same trigger; the game process keeps running (SIGSTOP/SIGCONT the
  process group as a stretch goal to cut CPU).
- True SoC suspend (`echo mem > /sys/power/state`, wake sources) is
  hardware-dependent — design the hook now, validate in Phase F.

- **Done when:** on the emulator, no input for the timeout produces the sleep
  frame and stops frame traffic; a button press restores the UI (test via the
  TCP backends); panel-driver calls are asserted with a fake panel.

### D5. Battery status *(F11 — software half)*

The BOM has **no fuel gauge today** (power is a bare Li-Ion pack; an IP5306 is
planned, and its basic variant has no telemetry). Split the feature:

- **Now (software):** a `BatteryProvider` protocol in the launcher
  (`percent`, `charging`, `available`) with three backends — `mock` (emulator,
  scriptable), `sysfs` (`/sys/class/power_supply/*`, works the day a gauge
  exists), `none` (icon hidden). Status-bar battery icon + About-page readout
  + low-battery warning dialog and auto-shutdown threshold.
- **Decision (with `case`):** an ADR choosing the measurement path — I2C fuel
  gauge (e.g. MAX17048) vs. IP5306-I2C variant vs. ADC — since the Pi has no
  onboard ADC. Real readings are validated at hardware bring-up (Phase F).

- **Done when:** the emulator shows a scripted battery level in the status bar,
  the low-battery flow triggers at the threshold, and the hardware ADR is
  accepted.

## Phase E — Hardware-readiness (still no board required)

*Make hardware day boring by preparing everything that can be prepared blind.*

### E1. Bring-up runbook + flip-point switches

Write `docs/hardware/bring-up.md`: the ordered on-board checklist (serial
console → boot → `glxinfo | grep llvmpipe` → panel init → first full refresh →
buttons → full session → Wi-Fi), with the three driver flip-points
(`EINKY_INVERT_FRAME`, `EINKY_GPIOCHIP`, BUSY polarity)
documented as boot-arg/env toggles requiring **no rebuild** (they already are env-driven — verify and document each).

### E2. Panel-driver desk-check and SPI dry-run harness

The C driver's waveform/command sequences for the GDEM0397T81P can be reviewed
against the GoodDisplay/GxEPD2 reference now, and a unit harness can record the
byte/gpio call sequence through the CFFI layer against a fake `spidev`/gpiod
(pure software) asserting init/partial/full/sleep sequences match the
datasheet. Finding a wrong LUT or missing BUSY wait costs minutes now versus
hours on a board.

### E3. Wi-Fi boot service finalisation

The Pi image already ships `wpa_supplicant`/firmware; finalise the service
wiring (start at boot, regulatory domain, `wpa_cli` control socket ownership)
so the launcher's `WpaCliBackend` finds a live daemon. Config-validated in
QEMU (service starts, backend degrades to "unavailable" without `wlan0`).

## Phase F — Hardware bring-up (needs the physical board)

The runbook from E1, executed: flash, serial boot, GL check, panel first
light, settle flip-points, buttons, full session on glass, refresh/ghosting
tuning (the `full_refresh_every` default and partial-refresh waveform quality
can only be judged by eye), real Wi-Fi join, power-off panel protection,
sleep-mode power draw (D4) and battery telemetry hardware (D5), and a battery
runtime measurement. Feed every deviation back into the contract, the driver
defaults, and the runbook. **Exit criterion = the goal statement:** flash →
plug in → boot → launcher → play, hands-off.

## Phase G — Ship-shape (post-bring-up polish)

Release engineering (versioned `sdcard.img` artifacts + flashing guide baked
by CI), first-boot data-partition expansion to fill the card, an update story
(A/B rootfs or reflash-safe-by-B1), and — later, per ADR 0003 — the
server/web catalog integration for pushing games over Wi-Fi.

---

## Suggested execution order (flat list)

| # | Step | Features | Needs hardware? |
|---|------|----------|-----------------|
| 1 | A1 scripted emulator acceptance test | F1–F3, F8, F9 | no |
| 2 | A2 cross-repo CI (image build + A1 as gate) | — | no |
| 3 | A3 session fault-injection tests | F3, F12 | no |
| 4 | B1 data partition + read-only rootfs | F5, F7 | no |
| 5 | B2 durable saves + autosave/crash recovery | F5, F12 | no |
| 6 | B3 splash + boot-time budget | F1 | no |
| 7 | B4 platform health: clock, memory, wear, watchdog | F5, F7, F12 | no |
| 8 | C1 game-packaging ADR + hook-injection mechanism | F2, F3 | no |
| 9 | C2 e-ink template + second title | F2, F8, F9 | no |
| 10 | C3 sideloading via the data partition | F2 | no |
| 11 | D1 refresh & image-quality engine (playbook as code) | F8 | no |
| 12 | D2 settings expansion (font size, display tuning, about) | F6 | no |
| 13 | D3 in-game menu + exact resume | F4, F10 | no |
| 14 | D4 sleep mode | F13 | no |
| 15 | D5 battery status (provider + UI + hardware ADR) | F11 | no |
| 16 | E1 bring-up runbook + no-rebuild flip-points | — | no |
| 17 | E2 SPI driver desk-check + fake-bus sequence tests | — | no |
| 18 | E3 Wi-Fi boot service | — | no |
| 19 | F hardware bring-up checklist | F11, F13 (hw half) | **yes** |
| 20 | G release engineering & update story | — | partially |

Steps 1–18 are deliberately hardware-free; any of 16–18 can be pulled earlier
if a board's arrival date firms up. Steps 11–15 are independent of each other
and of 8–10 (parallelizable, though D2 exposes options D1 defines), but all
assume the Phase A safety net exists.
