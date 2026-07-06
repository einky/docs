---
sidebar_position: 2
---

# Agent prompts (one per work package)

Ready-to-use briefs for delegating each [roadmap](./roadmap.md) step to an AI
coding agent. Each prompt is self-contained: paste the **common context block**
first, then the step's prompt, into a fresh agent session started at the
workspace root (the directory containing `meta/`, `buildroot_os/`, `runtime/`,
`launcher/`, `docs/`).

Ground rules baked into every prompt: the shared contract
(`meta/shared/hardware.toml` + `protocol.md`) is the single source of truth;
nothing is validated on real hardware (QEMU/host only); every change lands with
tests and a matching docs update.

## Common context block

Prepend this to every prompt below:

```text
CONTEXT (read before coding):
You are working in the einky workspace: a handheld e-ink console (Raspberry Pi
Zero 2 W, 800x480 1-bit GDEM0397T81P panel over SPI, 7 GPIO buttons) that runs
Ren'Py visual novels. Sibling repos: meta/ (shared contract + ADRs),
buildroot_os/ (InkyOS Buildroot image; QEMU emulator target = primary dev loop),
runtime/ (frame pipeline + keymap + C SPI driver library), launcher/ (native
Python boot UI that owns panel+buttons and spawns games; ADR 0009), docs/
(Docusaurus site), games/ (game projects).

Read first: docs/docs/architecture/overview.md, docs/docs/software/
boot-and-session.md, frame-pipeline.md, launcher.md, inkyos-build.md, and
meta/shared/protocol.md + hardware.toml.

Hard rules:
- meta/shared/ is the single source of truth for pins/geometry/wire formats;
  regenerate consumers (runtime `make gen`, buildroot_os
  `scripts/gen_hardware.py`), never hand-edit generated files.
- No physical hardware exists: validate everything on the QEMU emulator
  (buildroot_os/./build.sh qemu + ./run-emulator.sh) or host runs
  (launcher `make run-host`); keep hardware code paths env-switchable.
- Ship tests with every change (launcher/runtime pytest suites; emulator
  checks where relevant) and update the affected docs/ pages in the same
  change. Keep ruff + mypy clean (`make lint`).
- Do not bump pinned versions (meta/versions.env) unless the task says so.
```

---

## 1 — A1: Scripted emulator acceptance test

```text
TASK: Build the end-to-end acceptance test for the InkyOS emulator image.

Create a host-side script (suggested: buildroot_os/tests/e2e_emulator.py, plus
a thin `make e2e` / shell entry point) that with no interaction:
1. Boots the QEMU image (reuse the qemu invocation from buildroot_os/run-qemu.sh;
   ports 5333 frame / 5334 input are host-forwarded).
2. Waits for the launcher's first frame on TCP :5333 (protocol: "EINK" + u32
   width + u32 height + 48000 packed bytes, little-endian; reuse/refactor the
   client code in launcher/tools/dev_preview.py rather than reimplementing).
3. Asserts the frame against a committed golden 1-bit frame (allow a small
   pixel tolerance; provide a --bless flag to regenerate goldens).
4. Drives a scripted session over :5334 (ascii button names + "hold:start"):
   navigate library -> launch the_question -> assert frames start flowing and
   change -> advance dialogue -> hold-start exit -> assert the library frame
   returns -> open Settings > Power > Reboot -> assert the launcher comes back.
5. Exits nonzero with a saved PNG artifact of the offending frame on failure.

Constraints: pure host Python (stdlib + Pillow + numpy only), configurable
timeouts, must run headless (CI). Do not modify the image itself except, if
strictly needed, test-only hooks guarded by an env var in the qemu overlay.

DONE WHEN: `./build.sh qemu && make e2e` passes locally in minutes and fails
loudly if boot, the frame pipeline, input, session exit, or reboot breaks.
Document the workflow in buildroot_os/README.md and docs/docs/software/inkyos-build.md.
```

## 2 — A2: Cross-repo CI pipeline

```text
TASK: Set up CI so no repo can break the emulator boot or the shared contract.

1. Per-repo fast jobs: runtime and launcher -> `make lint` + `make test`;
   buildroot_os -> `scripts/gen_hardware.py --check`; runtime -> `make gen-check`
   (contract parity); a job asserting meta/versions.env pins match the
   Buildroot package pins (renpy.mk, Buildroot submodule tag, Python/Cython).
2. One expensive job: build the inky_qemu_defconfig image (cache .dl/ and
   .ccache/ aggressively between runs; the Mesa/LLVM build is the long pole)
   and run the A1 acceptance test (buildroot_os `make e2e`) against it.
3. Because the repos are siblings, the image job must check out runtime and
   launcher at the PR's ref and pass INKY_*_OVERRIDE_SRCDIR so the image is
   built from the PR code, mirroring what ./br.sh does locally.

Deliverables: workflow files per repo (GitHub Actions, org-shared where
sensible under .github/), a written note on cache strategy + expected runtimes,
and a docs page docs/docs/software/ci.md describing the gates.

DONE WHEN: a deliberately broken commit in each of runtime, launcher, and
buildroot_os fails CI, and a clean commit passes with the image job reusing
caches.
```

## 3 — A3: Session fault-injection tests

```text
TASK: Add fault-injection coverage for the launcher's session layer, so every
row of the failure-mode table in docs/docs/software/boot-and-session.md has a
test.

In launcher/tests/integration/ (extend the existing fake_game.py pattern):
- game process killed (SIGKILL) mid-frame -> GameExitEvent, library re-renders;
- fake game sends a garbage / oversized (>8 MiB) PNG length -> frame dropped or
  connection dropped, receiver thread survives, next frame still displays;
- game never opens its input socket -> forwarded presses are dropped silently,
  no exception, session still exits cleanly;
- Xvfb helper failure (make ensure_xvfb raise) -> "Could not start the game"
  error screen path, partial session torn down (socket unlinked);
- fast-exit crash (rc!=0 within 10s) vs normal exit -> error screen vs silent
  return (both directions asserted);
- backend.show raising OSError mid-session (fake backend) -> defined behaviour,
  document what it should be and implement if missing.
Plus one emulator-level check (can live in the A1 script as a scenario): kill
the inky-launcher process in the guest and assert the supervisor restarts it
and the UI comes back within ~10 s.

Constraints: no sleeps longer than necessary (poll with deadlines), tests must
be deterministic and pass under `make test`.

DONE WHEN: the failure-mode table in boot-and-session.md gains a "tested by"
reference per row and `make test` covers them all.
```

## 4 — B1: Data partition + read-only rootfs

```text
TASK: Give InkyOS a writable /data partition and a read-only root, on both
targets.

1. Pi target: extend the genimage configuration (see how
   board/raspberrypizero2w-64 + BR2_ROOTFS_POST_IMAGE_SCRIPT compose the
   sdcard.img) with a third partition, ext4, labelled "data", mounted at /data
   (fstab in a rootfs overlay). QEMU target: add a second virtio disk /
   partition with the same label and fstab entry; update run-qemu.sh /
   run-emulator.sh to create+attach it (idempotent).
2. Move the writable state there: EINKY_STATE_DIR=/data/inky and
   EINKY_GAMES_DIR=/data/games in both /etc/default/inky-session overlays.
   post-build.sh must now install the bundled game into an image-side seed
   location, with a first-boot init script that populates /data/games from the
   seed if empty (so reflashing the rootfs never wipes sideloaded games).
3. Mount the rootfs read-only (fstab + any tmpfs mounts needed: /tmp, /run,
   /var/log or redirect logs to /data/inky/logs). Fix every write the stack
   does outside /data (HOME=/root is one; audit with the emulator).
4. /data gets fsck-on-boot or a journaling setup such that a hard power cut is
   recovered automatically.

DONE WHEN: the A1 acceptance test passes on the new layout with the root
mounted ro; killing qemu mid-settings-write boots clean; settings and games
survive a rootfs-only reflash (simulate: replace rootfs image, keep data disk).
Update docs/docs/software/boot-and-session.md + inkyos-build.md and the
flashing page.
```

## 5 — B2: Durable saves + autosave + crash recovery (F5, F12)

```text
TASK: Make game progress durable and crash-recoverable.

1. Save location: in launcher/src/launcher/session/game_session.py, point each
   game's saves at /data/saves/<slug>/ — research the cleanest Ren'Py mechanism
   first (RENPY_PATH_TO_SAVES env var vs per-game config.savedir vs HOME): pick
   the one that needs no engine patch, works with the source-built engine at
   /opt/renpy, and keeps each game's saves isolated. Create the dir before
   spawn.
2. Autosave: ensure the engine autosaves during play for every game — set the
   relevant config (config.has_autosave / autosave frequency) in the shared
   e-ink options overlay that board/common/the_question-eink provides (and note
   it for the C2 game template).
3. Crash recovery (F12): verify and, if needed, wire the resume path — after a
   hard kill mid-game (SIGKILL the process group), relaunching the game must
   offer/perform a load of the newest autosave. Prefer engine-native behaviour
   (main menu Continue); only add launcher-side logic (e.g. a "Resume?" dialog
   using the newest file in /data/saves/<slug>/) if the engine path is
   insufficient. Keep it per-game-agnostic.
4. Tests: launcher integration test with the fake game writing a save file;
   emulator scenario (extend A1 or a sibling script): save in-game -> reboot ->
   load; SIGKILL mid-game -> relaunch -> autosave present and loadable.

DONE WHEN: saves survive reboot and rootfs reflash; a hard kill loses at most
the last few interactions; docs/docs/software/launcher.md (session lifecycle +
env table) and boot-and-session.md are updated.
```

## 6 — B3: Splash + boot-time budget (F1)

```text
TASK: Instant visual feedback at power-on and a tracked boot-time budget.

1. Splash: have the session layer show a static 1-bit "einky" splash frame as
   early as possible. Recommended shape: a tiny `inky-splash` step in
   inky-session.sh (or an earlier S-script) that pushes one pre-rendered packed
   frame through the launcher's display backend selection logic (spi on Pi /
   tcp on emulator) before inky-launcher finishes booting. Keep it dependency-
   free (the frame can be a committed 48000-byte asset generated at build time
   from a PNG by a small script). The launcher's first real render then
   replaces it (full refresh).
2. Budget: measure boot-to-first-frame and boot-to-interactive (first input
   accepted) in the emulator; emit both from the A1 script so CI records them.
   Apply the cheap wins: quiet kernel cmdline, drop unneeded init steps,
   defer anything not needed before the library renders. Do not micro-optimize
   beyond that.

DONE WHEN: on the emulator preview, a splash frame appears well before the
library (assert its golden in A1), timings are printed in CI output, and the
approach is documented in docs/docs/software/boot-and-session.md.
```

## 7 — C1: Game-packaging ADR + hook injection

```text
TASK: Define the einky game-packaging convention and make the bundled game
follow it. Write meta/adr/0010-game-packaging.md covering:
- Layout: /data/games/<slug>/ containing a standard Ren'Py project (game/ dir)
  plus inky-manifest.toml.
- Manifest schema v1: title, author, sort_key, cover (path), engine (min
  version), plus anything the library already reads
  (launcher/src/launcher/games/manifest.py is the current truth — extend it,
  don't fork it).
- Hook delivery: games must NOT hand-vendor eink_hook.rpy / input_hook.rpy.
  Decide and implement injection at install/scan time: the launcher (or a
  shared runtime helper) copies/refreshes the two hook files into
  <game>/game/ when (a) a game is first seen and (b) the hook version changes
  (version marker in the file header). The canonical hook sources move to a
  single shared location consumed by both the launcher and
  buildroot_os/board/common (which currently special-cases the_question).
- Cleanup: delete games/launcher (pre-ADR-0009 cruft); seed games/ with a
  README describing the convention.

Then implement: hook-injection in the launcher scan path with tests
(hook appears, hook updates on version bump, game's own files untouched), and
simplify buildroot_os post-build.sh to install the stock game + manifest only,
letting injection add the hooks.

DONE WHEN: the ADR is accepted (committed), the emulator image's the_question
gets its hooks via the mechanism (A1 still passes), and
docs/docs/software/launcher.md + a new docs page for game authors describe it.
```

## 8 — C2: e-ink game template + second title

```text
TASK: Create games/template-eink/ and a small second title from it.

Template: a minimal, immediately runnable Ren'Py project tuned for the device:
- 800x480, high-contrast black/white GUI (no gradients/alpha/animation-
  dependent feedback), large default text size, d-pad/A/B/start-only
  navigation (no mouse assumptions), gui.rpy reading a text-scale hint if D1
  has landed;
- e-ink-friendly in-game menu screens (save/load/prefs/quit) shared with D2;
- autosave configured per B2; inky-manifest.toml filled in; a cover.png sized
  for the library; NO vendored hook files (C1 injects them);
- a README for game authors: how to run it on the desktop SDK
  (meta/scripts/install-renpy-sdk.sh) and how to test on the emulator.
Second title: a short original demo VN (a few scenes, 2+ choices, images that
dither well) proving the template beyond the tutorial fixture.

Wire both into the emulator image alongside the_question (post-build seeds
/data/games per B1) so the library shows 3 entries.

DONE WHEN: both new games boot, play, save/load, and exit correctly on the
emulator via the seven buttons only; the library ordering/covers/manifests
render correctly; template usage is documented on a docs page for game authors.
```

## 9 — C3: Sideloading

```text
TASK: Make "drop a game folder onto the SD card" a supported feature.

1. Rescan: the launcher must pick up added/removed games without a reboot —
   rescan on every library screen enter (it may already; verify) and show
   an empty-library hint ("Add games to /data/games") when none are found.
   Handle a half-copied/invalid game dir gracefully (skipped, logged, never
   crashes the scan) — add unit tests with malformed dirs.
2. Validation UX: a game that fails C1 validation (no game/ dir, unreadable
   manifest) appears greyed-out or not at all (decide, document, test).
3. Document the workflow for users on a docs page (mount the data partition,
   copy the folder, eject) — this is the plug-and-play sideload story until
   USB gadget mode.
4. Stretch (only if time remains): prototype USB mass-storage gadget mode
   exposing the data partition (g_mass_storage / configfs) as a Pi-target
   config, OFF by default, documented as unvalidated-until-hardware.

DONE WHEN: on the emulator, adding/removing a game directory on the data disk
between library visits updates the list (integration test at launcher level +
one emulator scenario), and the user-facing sideload guide is published.
```

## 10 — D1: Settings expansion (F6)

```text
TASK: Expand the launcher Settings to the F6 feature set, adapted to e-ink.

1. Font size: a text-scale setting (e.g. small/medium/large) in SettingsStore,
   read by launcher/src/launcher/ui/theme.py so every screen scales; persist
   and apply live like full_refresh_every (ApplySettings). Pass a text-scale
   hint to games via the session env for the C2 template's gui.rpy to consume
   (games may ignore it).
2. Display tuning: keep full_refresh_every; add a dither threshold/contrast
   option if the shared pipeline exposes one cleanly (runtime
   frame_processor.dither) — if it requires touching runtime, add the
   parameter there with golden tests updated deliberately.
3. About page: image/version string (bake a /etc/inky-release file into the
   image at build time), free space on /data, IP address when networked.
4. Brightness & volume: NOT applicable (no backlight, no audio path). Add the
   one-paragraph rationale to the settings docs and the F6 row of the roadmap
   feature table so the feature list stays reconciled.

Constraints: pure black/white UI, d-pad navigable, every new setting covered by
the existing settings persistence integration test pattern.

DONE WHEN: three font scales render correctly (goldens or geometry assertions),
settings survive reboot on the emulator, About shows real values, and
docs/docs/software/launcher.md documents the new pages.
```

## 11 — D2: In-game menu + exact resume (F4, F10)

```text
TASK: Turn Ren'Py's game menu into the device's in-game menu, with verified
exact resume ("pop mode").

1. Screens: e-ink-friendly game-menu screens (save / load / preferences / quit
   — high contrast, no transparency/animations, d-pad + A/B navigation, B
   closes the menu and resumes) delivered via the C2 template and the shared
   overlay applied to bundled games. B button already queues `game_menu` (see
   input_hook.rpy); verify the flow end-to-end on the emulator.
2. Quit to library: a "Quit to library" item that cleanly ends the game process
   (renpy.quit()) so the launcher's normal exit path returns to the library —
   the polite alternative to hold-Start. Confirm rc==0 so no error screen.
3. Exact resume: closing the menu must return to the exact interaction; loading
   a save must restore the exact scene. Add an emulator/integration test:
   advance to a known scene -> open menu -> save -> quit to library -> relaunch
   -> load -> assert the same frame (golden with tolerance) as before saving.
4. Make sure menu navigation is fully operable with only the seven buttons
   (no hover/mouse dependencies), including the save-slot grid.

DONE WHEN: the scripted save->quit->relaunch->load->same-frame loop passes on
the emulator; docs (game-author page + launcher.md) describe the in-game menu
contract.
```

## 12 — D3: Sleep mode (F13)

```text
TASK: Implement inactivity sleep in the launcher (it owns the panel and the
buttons, so it must own sleep).

1. State machine in launcher/src/launcher/app.py (or a small sleep.py): after N
   minutes without any input event (setting "Sleep after", default 5 min, off
   option), enter SLEEP: render a dedicated sleep frame (e-ink holds it at zero
   power), call the display backend's panel sleep (SpiBackend -> Panel.sleep();
   define the equivalent no-op/marker for tcp/png backends), and stop frame
   pushing. Any button press wakes: re-init the panel, full refresh, swallow
   that first press (it must not also act on the UI).
2. In-game: same inactivity trigger (input events flow through the launcher, so
   it can tell); on sleep, stop forwarding and pushing frames; on wake, force a
   full refresh from the next game frame. Stretch: SIGSTOP/SIGCONT the game's
   process group while sleeping (config-gated, default off).
3. Timer must be testable: inject a clock, no real 5-minute waits in tests.
   Unit tests for the state machine + an integration test with a fake backend
   asserting the sleep()/init() call order and the swallowed wake press.
4. SoC suspend is out of scope (hardware-dependent): leave a documented hook
   (env-gated command on entering sleep) for Phase F.

DONE WHEN: on the emulator (short timeout via env), no input produces the sleep
frame and frame traffic stops; a button restores the UI; tests cover menu and
in-game paths; docs/docs/software/launcher.md + boot-and-session.md updated.
```

## 13 — D4: Battery status (F11, software half)

```text
TASK: Build the battery-status feature against an abstraction, since the BOM
has no fuel gauge yet (bare Li-Ion; IP5306 planned, basic variant has no
telemetry).

1. BatteryProvider protocol in the launcher (launcher/src/launcher/settings/
   or a new power module): available() -> bool, percent() -> int|None,
   charging() -> bool|None. Backends: MockProvider (EINKY_BATTERY_BACKEND=mock,
   level scriptable via env/file so the emulator can animate it),
   SysfsProvider (reads /sys/class/power_supply/*/capacity,status — dormant
   until real hardware exists), NullProvider (feature hidden). Selection
   mirrors the existing wifi backend pattern (settings/wifi.py).
2. UI: battery icon + percent in the StatusBar (1-bit friendly glyphs at all D1
   font scales); readout on the About/Power page; a low-battery warning dialog
   at a threshold (setting, default 15%); auto clean shutdown at a critical
   threshold (default 5%, reuses the existing power path with panel deep-sleep)
   — thresholds only active when a provider is available.
3. Poll on a slow timer (>=30 s) — never per-frame.
4. Hardware decision: draft meta/adr/0011-battery-telemetry.md comparing I2C
   fuel gauge (MAX17048-class) vs IP5306-I2C variant vs external ADC, with a
   recommendation and the SysfsProvider/kernel implications; real validation
   is deferred to hardware bring-up.

DONE WHEN: emulator shows a scripted battery level, low/critical flows trigger
in an integration test (critical asserts the shutdown path was invoked, mocked),
the icon renders at all font scales, and the ADR draft is committed.
```

## 14 — E1: Bring-up runbook + flip-point switches

```text
TASK: Write the hardware bring-up runbook and guarantee every bring-up variable
is switchable WITHOUT rebuilding the image.

1. Verify (and fix where untrue) that these are runtime-switchable via
   /etc/default/inky-session or kernel cmdline, not compile-time:
   EINKY_INVERT_FRAME (frame polarity), EINKY_GPIOCHIP (gpiochip index), BUSY
   polarity (add an env if the C driver hard-codes it — check
   runtime/src/spi_driver/spi_driver.c), GPIOZERO_PIN_FACTORY, EINKY_SPI_DEV,
   and SPI bus speed if configurable. Small runtime/ code changes are in scope
   if a flip-point is currently hard-coded; keep contract.h values as the
   defaults.
2. Write docs/docs/hardware/bring-up.md: the ordered on-board checklist —
   serial console wiring/settings -> first boot output -> login -> `glxinfo |
   grep llvmpipe` -> panel init log lines -> first full refresh -> flip-point
   triage table (symptom -> which switch to flip: inverted image, no BUSY
   release, wrong gpiochip, dead SPI) -> buttons (gpioinfo + launcher log) ->
   full session -> Wi-Fi -> shutdown/panel-sleep check. Each step: expected
   output, failure branches, and where the logs live.
3. Cross-link from the flashing page and the roadmap.

DONE WHEN: every flip-point is demonstrably env-switchable (show it in the
emulator where possible: e.g. EINKY_INVERT_FRAME visibly inverts the tcp
preview), and the runbook is complete enough that someone with the board and no
context could execute it.
```

## 15 — E2: SPI driver desk-check + fake-bus harness

```text
TASK: De-risk the GDEM0397T81P C driver before any board exists.

1. Desk-check: compare runtime/src/spi_driver/spi_driver.c command/waveform
   sequences (init, partial refresh, full refresh, deep sleep, BUSY waits)
   against the GoodDisplay GDEM0397T81P datasheet / demo code and the GxEPD2
   driver for the same panel class (research them online). Produce a findings
   table: sequence | ours | reference | verdict/fix. Apply unambiguous fixes;
   flag judgement calls as flip-points for the runbook (E1).
2. Fake-bus harness: a test build of the CFFI extension (or a link-seam) where
   spidev ioctls/writes and gpiod line ops are recorded instead of executed —
   pure software, no kernel deps. Unit tests then assert, for init/partial/
   full/sleep: exact command-byte sequences, DC/RST line states around each
   phase, BUSY polled with a timeout (and a test that a stuck-BUSY times out
   with a clean error instead of hanging forever — add the timeout if missing),
   and the frame-inversion behaviour of EINKY_INVERT_FRAME.
3. Keep the harness in runtime/tests/ wired into `make test` (skip cleanly if
   the C extension can't build on the host).

DONE WHEN: the findings table is committed (docs or runtime/docs), sequence
tests pass and pin the driver's behaviour, and any datasheet deviations are
either fixed or documented as explicit flip-points.
```

## 16 — E3: Wi-Fi boot service finalisation

```text
TASK: Finalise the Pi image's Wi-Fi plumbing so the launcher's WpaCliBackend
finds a working daemon on hardware day.

1. Boot service: an init script (S4x) on the Pi target starting wpa_supplicant
   on wlan0 with a persistent config under /data (survives reflash, per B1),
   control socket where wpa_cli expects it; udhcpc hooked to association.
   Regulatory domain set (make the country an /etc/default knob).
2. Verify the launcher side: WpaCliBackend's exact wpa_cli call sequence
   (scan/add_network/set_network/enable/save_config) against the shipped
   wpa_supplicant version's CLI; fix mismatches with unit tests around the
   parser (launcher/tests/unit/test_wifi.py pattern).
3. Emulator validation (no wlan0 there): service starts and idles/degrades
   cleanly, launcher shows "Wi-Fi unavailable" (NullBackend) — no crashes, no
   boot-time delay from the service. Keep EINKY_WIFI_BACKEND=mock working for
   UI testing.
4. Document the credential-persistence + privacy note (passphrase stored in
   wpa_supplicant.conf on /data) in the settings docs.

DONE WHEN: the Pi image builds with the service enabled, the emulator boots
with zero regression (A1 passes) and clean Wi-Fi-unavailable behaviour, and the
runbook (E1) gains the Wi-Fi validation step.
```

## 17 — F: Hardware bring-up (requires the board)

```text
TASK: Execute docs/docs/hardware/bring-up.md on the physical device and drive
every deviation back into code/docs.

Follow the runbook in order: flash -> serial boot -> glxinfo/llvmpipe -> panel
first light -> settle the flip-points (record final values of
EINKY_INVERT_FRAME, EINKY_GPIOCHIP, BUSY polarity, pin factory) -> buttons ->
full session on glass -> refresh/ghosting tuning by eye (settle the
full_refresh_every default; adjust the contract [refresh] if needed and
regenerate everywhere) -> real Wi-Fi join -> shutdown/panel-protection -> sleep
mode power behaviour (D3) -> battery telemetry hardware if fitted (D4 ADR) ->
battery runtime measurement.

For every deviation: fix the default in the right layer (contract > runtime >
overlay), never in a one-off image tweak; update the runbook so the next board
is boring; keep a bring-up log in docs (date, board rev, findings).

DONE WHEN: a freshly flashed card boots to the launcher and plays a game
hands-off on the real panel with real buttons, and all flip-point finals are
committed as defaults.
```

## 18 — G: Release engineering & update story

```text
TASK: Make shipping images a repeatable, versioned process.

1. Versioning: a scheme for InkyOS releases (image version baked into
   /etc/inky-release, shown in Settings > About per D1); git tags across
   buildroot_os/runtime/launcher pinned together per release.
2. CI release job: on tag, build the Pi sdcard.img (and the qemu image),
   attach checksums, publish as a release artifact with the flashing guide.
3. First boot: expand the /data partition to fill the SD card (one-shot init
   script; test the mechanism in QEMU with an oversized disk).
4. Update story: document and choose (small ADR) between "reflash rootfs, /data
   survives" (already true after B1 — make it the official v1 story with a
   guide) vs A/B rootfs slots (defer unless cheap).
5. Housekeeping: the archived `os/` pi-gen repo gets a final deprecation README
   pointing at buildroot_os.

DONE WHEN: tagging a release produces downloadable, checksummed images + docs
without manual steps, first boot fills the card, and the documented update path
has been exercised once in the emulator.
```
