---
sidebar_position: 2
---

# Agent prompts (one per work package)

Ready-to-use briefs for delegating each [roadmap](./roadmap.md) step to an AI
coding agent. Each prompt is self-contained: paste the **common context block**
first, then the step's prompt, into a fresh agent session started at the
workspace root (the directory containing `meta/`, `buildroot_os/`, `runtime/`,
`launcher/`, `docs/`).

Every prompt bakes in the same ground rules (contract as source of truth,
QEMU/host-only validation, tests + docs with every change) and carries a
**PITFALLS** section — the known traps for that step, including the e-ink
physics from the [E-ink playbook](../software/eink-playbook.md).

## Common context block

Prepend this to every prompt below:

```text
CONTEXT (read all of this before coding):

You are working in the einky workspace: a handheld e-ink console (Raspberry Pi
Zero 2 W, 512 MB RAM, no GPU-GL) that runs Ren'Py visual novels on an 800x480
1-bit GDEM0397T81P e-paper panel over SPI, with 7 GPIO buttons (up/down/left/
right/a/b/start). Sibling repos:
  meta/         shared contract (shared/hardware.toml + shared/protocol.md),
                ADRs, versions.env — THE single source of truth
  buildroot_os/ InkyOS Buildroot image (br2-external tree). Two targets:
                inky_defconfig (Pi, untested on real hardware) and
                inky_qemu_defconfig (QEMU aarch64 virt — the primary dev loop:
                ./build.sh qemu && ./run-emulator.sh)
  runtime/      shared library: frame pipeline (greyscale->Floyd-Steinberg->
                pack 1-bit), contract keymap, C SPI panel driver (CFFI+libgpiod)
  launcher/     native Python boot UI (ADR 0009). Owns the panel + buttons for
                the whole uptime; spawns Ren'Py games as child processes and
                bridges frames/input over two Unix sockets
  docs/         Docusaurus site — the source of truth for architecture
  games/        Ren'Py game projects

READ FIRST (in this order):
  docs/docs/architecture/overview.md
  docs/docs/software/boot-and-session.md
  docs/docs/software/frame-pipeline.md
  docs/docs/software/launcher.md
  docs/docs/software/inkyos-build.md
  docs/docs/software/eink-playbook.md   <- e-ink refresh/dither/health rules
  meta/shared/hardware.toml + meta/shared/protocol.md

HARD RULES:
- meta/shared/ is the single source of truth for pins/geometry/wire formats/
  button names. Regenerate consumers (runtime: `make gen`; buildroot_os:
  `python3 scripts/gen_hardware.py`); NEVER hand-edit generated files or
  duplicate contract values.
- No physical hardware exists. Validate on the QEMU emulator or host runs
  (launcher: `make run-host` + `make preview` + `make send-input`). Keep
  hardware code paths env-switchable and testable with fakes.
- E-ink discipline (docs/docs/software/eink-playbook.md): never queue panel
  refreshes (drop frames, show newest); full refresh on layout changes/wake/
  game handoff, partial for small deltas, skip byte-identical frames; no
  animations/transitions anywhere; panel deep-sleep when idle/off; all panel
  access serialized behind the launcher's single backend; BUSY waits must
  have timeouts.
- Platform discipline: 512 MB RAM total (QEMU runs -m 512 on purpose — keep
  it); no RTC (wall-clock time is wrong until NTP — never make correctness
  depend on timestamps); SD card is the disk (minimize writes: no per-frame/
  per-keypress writes, cap+rotate logs); everything writable belongs under
  /data (EINKY_STATE_DIR) once the B1 partition exists, the rootfs is
  (to become) read-only.
- Ship tests with every change: launcher/runtime `make test` (pytest) +
  `make lint` (ruff + mypy --strict) must pass; golden 1-bit frames pin
  rendering/dither output (regenerate goldens only deliberately, with
  a --bless flag or equivalent, and eyeball the diff).
- Update the affected docs/ pages in the same change (they are the source of
  truth; stale docs are a bug). If you change behaviour described in
  boot-and-session.md / frame-pipeline.md / launcher.md / eink-playbook.md,
  fix the page.
- Do not bump pinned versions (meta/versions.env, Buildroot submodule,
  Ren'Py 8.5.2) unless the task explicitly says so.
- Buildroot gotchas: config-only changes do NOT rebuild a package (use
  `./build.sh qemu <pkg>-dirclean` then rebuild); local repos are built via
  OVERRIDE_SRCDIR (./br.sh mounts ../runtime and ../launcher) — stale deleted
  files can linger in the build dir, dirclean when in doubt; `make
  savedefconfig` drops comments from defconfigs, so edit configs/ carefully
  by hand and keep the comments.
- Sockets/protocols: frame stream = "EINK" + u32 w + u32 h + 48000 packed
  bytes (LE, bit 1 = white, MSB first); engine capture = u32 BE length + PNG
  on /tmp/renpy-eink.sock; input = ascii button names, one per line, on
  /tmp/renpy-input.sock or TCP :5334; "hold:start" is the exit combo on dev
  transports, a 2 s GPIO hold on device.
```

---

## 1 — A1: Scripted emulator acceptance test

```text
TASK: Build the end-to-end acceptance test for the InkyOS emulator image.

Create a host-side script (suggested: buildroot_os/tests/e2e_emulator.py, plus
a `make e2e` / shell entry point) that with no interaction:
1. Boots the QEMU image (reuse the exact qemu invocation from
   buildroot_os/run-qemu.sh — virt machine, -m 512, hostfwd 5333/5334; keep
   -m 512 so memory regressions surface here).
2. Waits for the launcher's first frame on TCP :5333. Reuse/refactor the frame
   client from launcher/tools/dev_preview.py into an importable module rather
   than reimplementing the protocol.
3. Asserts the frame against a committed golden 1-bit frame. Provide --bless
   to regenerate goldens and print a visual diff summary (changed-pixel count
   + a saved side-by-side PNG) so a human can approve.
4. Drives a scripted session over :5334 (ascii names + "hold:start"):
   navigate library -> launch the_question -> assert frames start flowing and
   differ from the library frame -> advance dialogue (a) -> open in-game menu
   (b) and close it -> hold:start to exit -> assert the library frame returns
   -> Settings > Power > Reboot -> assert the launcher comes back.
5. Emits timing metrics (boot-to-first-frame, boot-to-interactive) on stdout
   in a stable parseable line (CI will track them, step B3 consumes this).
6. On failure: exit nonzero, save the offending frame as PNG plus the last
   ~100 lines of guest serial output as artifacts.

PITFALLS — think about these:
- Timing flakiness is the killer. Ren'Py's first boot takes tens of seconds
  (llvmpipe JIT); every wait must be a poll-with-deadline (generous defaults,
  env-overridable), never a fixed sleep. The frame connection also drops and
  reconnects when the launcher restarts — the client must retry.
- Golden brittleness: font rendering inside the image is stable (same
  freetype/fonts baked in), so exact-match goldens are fine for LAUNCHER
  frames, but GAME frames (dithered) may vary — for those assert invariants
  (frame changed, >N% black pixels, not equal to library frame) instead of
  exact goldens.
- Frames are pushed on change, not continuously: after an action, wait for
  the NEXT frame, not a fixed count; the launcher skips renders when nothing
  changed (by design).
- Input reaches the game only after its input_hook socket is up (Ren'Py boot
  lag): send a probe press pattern and wait for a frame reaction before
  asserting dialogue advances.
- The reboot step: TCP connections die; the script must treat connection
  reset as expected there and reconnect with the boot deadline.
- Don't leak QEMU processes on failure (context manager / finally kill), and
  support a lockfile or unique ports so two runs don't collide.
- Serial console is the only guest log access — capture it from the start
  (subprocess pipe), or you'll have nothing to attach on failure.

DONE WHEN: `./build.sh qemu && make e2e` passes locally in minutes, fails
loudly (with artifacts) on a broken boot/pipeline/input/session/reboot, has no
fixed sleeps, and is documented in buildroot_os/README.md +
docs/docs/software/inkyos-build.md.
```

## 2 — A2: Cross-repo CI pipeline

```text
TASK: Set up CI so no repo can break the emulator boot or the shared contract.

1. Per-repo fast jobs: runtime + launcher -> `make lint` + `make test`;
   buildroot_os -> `python3 scripts/gen_hardware.py --check`; runtime ->
   contract parity (`make gen` then git-diff must be clean); a job asserting
   meta/versions.env pins match the Buildroot mirrors (package/renpy/renpy.mk
   version, Buildroot submodule tag, target Python / host Cython from the
   Buildroot config).
2. The expensive job: build inky_qemu_defconfig and run the A1 acceptance test
   on the artifact. The repos are siblings: check out runtime + launcher at
   the PR's ref next to buildroot_os and pass INKY_RUNTIME_OVERRIDE_SRCDIR /
   INKY_LAUNCHER_OVERRIDE_SRCDIR (mirroring ./br.sh) so the image contains
   the PR's code, not the pinned tags.
3. Caching: persist .dl/ (downloads) and .ccache/ between runs — the
   Mesa/LLVM build is hours cold, minutes warm. Also cache the Buildroot
   output tree if the runner supports it, but treat it as advisory (a
   defconfig change must force a clean build).
4. Artifacts: on e2e failure upload the frame PNGs + serial log from A1.

PITFALLS — think about these:
- Runner shape: the image build needs Docker (br.sh is containerized), tens
  of GB of disk, and hours on a cold cache — set timeouts accordingly and
  make the expensive job skippable by label for docs-only changes.
- QEMU on CI: needs qemu-system-aarch64 on the runner (TCG, no KVM for
  aarch64-on-x86) — the guest is SLOW; A1's deadlines must scale via env
  (e.g. E2E_TIMEOUT_MULT=3 on CI).
- Cache poisoning: a corrupted ccache/dl entry can wedge every build — key
  caches on the Buildroot submodule SHA and provide a manual cache-bust
  switch.
- Cross-repo trigger problem: a launcher PR must run the image job with ITS
  branch but default branches of the others; define the checkout matrix
  explicitly, don't assume same-name branches exist everywhere.
- OVERRIDE_SRCDIR skips hash checks — that's correct for PR code, but the
  pinned-tag path (no override) must stay green too: keep one nightly build
  without overrides to catch drift in the pins.
- Secrets: the repos may be private — the workflow needs a token able to
  clone siblings; scope it read-only.

DONE WHEN: a deliberately broken commit in each of runtime, launcher, and
buildroot_os fails CI; a clean commit passes with warm caches in reasonable
time; the pipeline is documented in a new docs/docs/software/ci.md page.
```

## 3 — A3: Session fault-injection tests

```text
TASK: Add fault-injection coverage for the launcher's session layer, so every
row of the failure-mode table in docs/docs/software/boot-and-session.md has a
test.

In launcher/tests/integration/ (extend the existing fake_game.py pattern):
- game process SIGKILLed mid-frame -> GameExitEvent posted, session torn down,
  library re-renders (full refresh), input socket unlinked;
- fake game sends garbage bytes / an oversized (>8 MiB) length header -> the
  frame or connection is dropped, the receiver thread survives, a subsequent
  valid frame still displays;
- a PNG with the WRONG DIMENSIONS (not 800x480) -> define the behaviour
  (scale? letterbox? drop+log?), implement it deliberately, and test it —
  today it likely produces a mis-sized packed frame downstream;
- game never opens its input socket -> presses are dropped silently, no
  exception, no unbounded reconnect spin (verify there's a backoff or
  per-press retry only), session still exits cleanly;
- ensure_xvfb raising -> "Could not start the game" error screen, partial
  session torn down (receiver stopped, socket unlinked — assert the file is
  gone);
- fast-exit crash (rc!=0 within 10 s) shows the error screen; normal exit
  (rc==0, however fast... check: rc==0+fast currently shows nothing — decide
  and pin the intended behaviour) returns silently;
- display backend .show() raising OSError mid-session -> define + implement +
  test (the launcher must never die because the preview client vanished; the
  TcpBackend should drop frames with no client — verify that's true under a
  client that connects then disconnects mid-frame);
- two games launched back-to-back rapidly (launch, exit, launch) -> no stale
  socket ("address already in use"), no crossed receiver threads.
Plus one emulator-level scenario (add to the A1 script): `kill -9` the
inky-launcher PID via the serial console and assert the supervisor brings the
UI back (new frame on :5333) within ~15 s.

PITFALLS — think about these:
- Determinism: no arbitrary sleeps; synchronize with events/files/socket
  states, poll with deadlines. Flaky fault tests are worse than none.
- Unix socket paths collide across parallel tests — use per-test tmp_path
  sockets (the env vars already allow overriding RENPY_EINK_SOCKET /
  RENPY_INPUT_SOCKET).
- Thread leakage: each test must assert the receiver/watcher threads are
  joined after stop() (hanging daemon threads hide real bugs and slow the
  suite).
- The fake game must be able to misbehave on command (send garbage, wrong
  size, die at a phase) — extend it with a scriptable scenario arg rather
  than writing N fake games.
- Some behaviours are currently UNDEFINED in the code — the task includes
  choosing and implementing the sane behaviour, not just testing whatever
  happens; record each decision in boot-and-session.md's table.

DONE WHEN: every failure-mode row in boot-and-session.md names its test, all
tests pass deterministically under `make test`, and newly-defined behaviours
are implemented + documented.
```

## 4 — B1: Data partition + read-only rootfs

```text
TASK: Give InkyOS a writable /data partition and a read-only root, on both
targets.

1. Pi target: extend the SD layout (see how board/raspberrypizero2w-64
   post-image + genimage compose sdcard.img; our sync-config-txt.sh already
   chains before it) with a third partition, ext4, label "data". QEMU target:
   a second virtio disk with the same label; run-qemu.sh / run-emulator.sh
   create it idempotently (qemu-img/truncate) and attach it.
2. Mount by LABEL (fstab in a rootfs overlay), options
   noatime,commit=30,data=ordered; fsck on boot or rely on the journal —
   a hard power cut must self-heal.
3. Move writable state: EINKY_STATE_DIR=/data/inky, EINKY_GAMES_DIR=
   /data/games in both /etc/default/inky-session overlays. post-build.sh now
   installs the bundled game to a read-only seed dir (e.g. /usr/share/inky/
   games-seed/); a first-boot init script populates /data/games from the seed
   when empty — so a rootfs reflash never wipes sideloaded games or saves.
4. Root read-only: fstab ro + tmpfs for /tmp, /run, /var/run; decide /var/log
   (tmpfs with small size cap, real logs go to /data/inky/logs — coordinate
   with B4's rotation). Audit every write the stack does outside /data by
   booting the emulator and watching for EROFS in serial/log output:
   known offenders to check — HOME=/root (Ren'Py writes ~/.renpy), Xvfb
   -fbdir, wpa_supplicant.conf (E3 will want /data), dhcp leases,
   /var/lib/inky default, random-seed.

PITFALLS — think about these:
- BusyBox init mounts: ensure an early rcS step mounts /data BEFORE
  S95inky-session needs it, and that a MISSING/corrupt data partition still
  boots to a usable error state (launcher shows a message) instead of a
  half-dead session — test that path.
- The ext4 "data" label must be created at image-build time for the Pi
  (genimage) but possibly first-boot for QEMU's raw disk — keep one init
  script that handles "no filesystem yet" for both (mkfs if blank), which
  also prepares G's expand-to-fill-card work.
- EROFS failures are often silent (code catches OSError and moves on) — grep
  the whole stack for writes, don't just watch it boot: settings save, cover
  cache, game logs, save games, Xvfb, wpa, ntp/fake-hwclock (B4).
- Buildroot: BR2_TARGET_GENERIC_REMOUNT_ROOTFS_RW must be OFF (it defaults
  to remounting rw); check inittab.
- QEMU serial login writes (root's shell history etc.) — acceptable on
  tmpfs, but don't let convenience writes mask real EROFS bugs: test with a
  truly ro root.
- Keep the A1 goldens valid: moving games to /data changes nothing visible,
  but the first-boot seed step adds boot time — A1's deadline may need a
  bump on first boot vs warm boot (two different timings; measure both).

DONE WHEN: A1 passes on the new layout with root mounted ro on both targets;
killing qemu mid-settings-write boots clean; a rootfs-image swap preserves
/data contents (simulated reflash test); missing-data-partition boots to a
clear error screen; docs (boot-and-session.md, inkyos-build.md, flashing page)
updated with the new layout.
```

## 5 — B2: Durable saves + autosave + crash recovery (F5, F12)

```text
TASK: Make game progress durable and crash-recoverable.

1. Save location: research Ren'Py 8.5's save-path resolution order FIRST
   (renpy-8.5.2-sdk source is available for study: renpy/loadsave.py,
   renpy/savelocation.py, launcher env vars like RENPY_PATH_TO_SAVES, and
   config.save_directory) and pick the mechanism that (a) needs no engine
   patch, (b) works with the source-built engine at /opt/renpy, (c) isolates
   per-game saves. Implement it via GameSession's spawn env in
   launcher/src/launcher/session/game_session.py -> /data/saves/<slug>/
   (create parents before spawn, owned correctly).
2. Autosave: ensure autosave-on-interaction is active for every game — set it
   in the shared e-ink options overlay (board/common/the_question-eink/game/
   options.rpy today; note it for the C2 template). Check Ren'Py's autosave
   knobs: config.has_autosave, config.autosave_frequency, and that autosave
   actually triggers on choices (_autosave_on_choice).
3. Crash recovery (F12): after a hard kill mid-game (SIGKILL the process
   group), relaunching the game must offer/perform a resume from the newest
   autosave. Prefer the engine-native path (main menu "Continue"/auto-load);
   add launcher-side logic only if the engine path is insufficient — and if
   you do, select the newest save WITHOUT trusting mtimes (no RTC! use
   Ren'Py's own slot metadata or a monotonic sequence — see B4).
4. Sync discipline: saves must actually hit the SD card — verify Ren'Py
   fsyncs its save writes (study loadsave.py); if not, mount /data
   appropriately or add a sync after GameExitEvent. Balance against SD wear:
   do NOT mount sync.
5. Tests: launcher integration test with the fake game writing into its save
   dir; emulator scenarios (extend A1 or a sibling script): save -> reboot ->
   load; SIGKILL mid-game -> relaunch -> autosave offered/loadable; saves
   survive a rootfs-image swap.

PITFALLS — think about these:
- Ren'Py "persistent" data (settings/seen-text) lives beside saves — make
  sure it moves too, or players lose preferences/read-text skip state.
- Save slots contain SCREENSHOTS taken by the engine — on our headless Xvfb
  this works but bloats save size at 800x480; check config knobs if size is
  an issue on /data.
- Multiple games must never share a save dir (slug collisions: the library
  scan must guarantee slug uniqueness — check games/library.py and add a
  test).
- HOME=/root is exported by inky-session for OTHER reasons (engine caches);
  if you redirect saves via HOME instead of a save-specific mechanism, you
  move those caches to /data too — decide deliberately where cache vs saves
  live (cache is disposable; put it on tmpfs or /data/cache).
- The first-run of a game creates the save dir structure — creating it
  pre-spawn with wrong ownership/permissions breaks silently (games run as
  root today, but don't bake that assumption in).
- Autosave frequency trades progress-loss vs SD wear: pick a sane default
  (e.g. every few interactions), make it a template option, document it.

DONE WHEN: saves + persistent data survive reboot and rootfs reflash; a hard
kill mid-game loses at most the last few interactions and resume works via
buttons only; no mtime-based "newest" logic exists; docs updated
(launcher.md session env, boot-and-session.md, eink game-author page).
```

## 6 — B3: Boot splash + boot-time budget (F1)

```text
TASK: Instant visual feedback at power-on and a tracked boot-time budget.

1. Splash: push a static 1-bit "einky" splash frame to the panel path as
   early as possible. Recommended: a tiny standalone step in inky-session.sh
   (before the supervisor loop) that writes one pre-rendered 48000-byte
   packed frame through the same backend selection the launcher uses (spi on
   Pi / tcp on emulator). The asset is generated at image build time from a
   committed PNG by a small script (do NOT hand-maintain binary frames; the
   generator lives in the repo and CI can regenerate). Full refresh, then
   leave it — the launcher's first real render replaces it.
2. Budget: use A1's boot-to-first-frame and boot-to-interactive metrics;
   apply the cheap wins only: kernel cmdline `quiet`, drop unused init
   scripts, don't gate inky-session on network. Record numbers before/after
   in the PR.

PITFALLS — think about these:
- The splash step must NOT hold the panel/port open: on the emulator the
  TcpBackend BINDS :5333 — two binders collide. Either the splash goes
  through a short-lived connection the launcher's backend can survive, or
  (simpler) the splash step only handles the SPI path on the Pi and skips on
  tcp (the emulator boots fast enough that a splash matters less) — decide,
  document, and make A1 tolerant of an optional splash frame arriving before
  the library golden.
- e-ink discipline: exactly ONE full refresh for the splash; do not animate;
  the launcher's first frame should also be full (it is, on boot) — two
  fulls back-to-back is acceptable, three+ is user-visible churn.
- On the Pi path the splash step will be the FIRST opener of /dev/spidev0.0
  and must deep-sleep or cleanly close so the launcher's SpiBackend can
  re-init without a stuck BUSY — keep the step "init, push, sleep, close",
  and reuse runtime's driver (no second SPI implementation!).
- Boot-time numbers in QEMU/TCG do not equal Pi numbers — treat them as
  relative regression tracking only; say so in the docs.
- Don't strip init output so aggressively that bring-up (Phase F) loses the
  serial breadcrumbs — `quiet` on cmdline but keep rcS echo lines.

DONE WHEN: a splash frame appears well before the library on the panel path
(emulator: assert in A1 if the tcp splash is implemented, else unit-test the
generator + Pi script path), timings are emitted by A1 and tracked in CI, and
boot-and-session.md documents the splash step.
```

## 7 — B4: Platform health — clock, memory, storage wear, watchdog

```text
TASK: Make the appliance survive months of unattended real-world use: correct
enough time without an RTC, bounded memory, bounded disk writes, and recovery
from hangs (not just crashes).

1. Clock (no RTC on the Pi Zero 2 W — time starts at epoch every boot):
   - fake-hwclock: persist the current time to /data periodically (e.g.
     every 15 min) and at clean shutdown; restore at early boot (before
     anything logs or writes files).
   - busybox ntpd, started opportunistically when a network appears (hook
     off the Wi-Fi path from E3; must not delay boot or run without net).
   - Audit the stack for wall-clock dependencies and fix them: "newest
     autosave" (B2 — sequence numbers/slot metadata), cover-cache
     invalidation (content hash, not mtime), log timestamps (fine to be
     wrong, note it), TLS/cert validation (only matters when server work
     lands — document the constraint).
2. Memory budget (512 MB total, llvmpipe is the hog):
   - Measure in the emulator: RSS of Xvfb + Ren'Py + launcher during a game
     session (add a probe to the A1 script; parse /proc/<pid>/status via
     serial or a tiny guest script).
   - Set defaults: LP_NUM_THREADS (llvmpipe threads; 4 threads on 4 cores is
     rarely worth the memory — try 2), Ren'Py config.image_cache_size in the
     shared options overlay, and add zram swap (Buildroot: kernel option +
     init script) as the safety valve.
   - Assert a ceiling in A1 (fail if a session exceeds, say, 420 MB — pick
     from measurement, leave headroom).
3. SD wear & write hygiene:
   - Mount options from B1 (noatime); debounce settings writes in the
     launcher's SettingsStore (dirty-flag + flush after N seconds of quiet
     and on power/session events — never per-keypress);
   - Logging: size-capped rotating logs in /data/inky/logs (launcher already
     writes per-game logs — cap them; the supervisor's launcher.log grows
     forever today — rotate it; busybox syslogd -s/-b flags or a logrotate
     init step).
4. Watchdog (a hung launcher currently bricks the session — the supervisor
   only catches EXITS):
   - Launcher heartbeat: touch/update a file (or write a byte to a pipe)
     from the main loop every iteration with a coarse cadence;
   - Supervisor (inky-session.sh) checks staleness and kills -9 the launcher
     when the heartbeat stops (panel re-inits on restart — acceptable);
   - Optional second layer: busybox watchdog on /dev/watchdog (BCM2835 has
     one) for kernel-level hangs — Pi target only, config-gated.

PITFALLS — think about these:
- The heartbeat must come from the MAIN LOOP (queue.get with a timeout so an
  idle launcher still beats), not a side thread — a deadlocked main loop
  with a healthy heartbeat thread is exactly the failure you're guarding
  against. Careful: queue.get currently blocks forever; adding a timeout
  changes the loop — keep the render-skip behaviour intact.
- In-game, the launcher main loop is mostly idle routing — the heartbeat
  cadence must survive that mode too (it does if driven by the timeout).
- Do NOT let the watchdog kill during a legitimate long operation (game
  spawn ~tens of seconds is fine — spawn happens off the loop's critical
  path; wifi connect is synchronous in a screen! Either exempt via a longer
  timeout or move wifi connect off-loop — check screens/wifi.py and decide).
- fake-hwclock restore must run before fsck logs / first writes, i.e. very
  early in rcS ordering; and time can go BACKWARDS across a crash (persisted
  time is stale) — nothing may assume monotonic wall-clock; use
  time.monotonic() in code, always.
- zram: compression costs CPU on a device that also software-renders;
  measure a game session with and without before enabling by default.
- QEMU TCG memory behaviour matches (same -m 512) but SPEED doesn't — pick
  the RSS ceiling from emulator numbers, revisit at Phase F.

DONE WHEN: reboots preserve approximate time without network; time-dependent
correctness bugs are gone (grep + tests); a session's RSS is measured and
gated in CI; logs are size-bounded (test: fill them, assert rotation);
settings writes are debounced (test); a SIGSTOPped launcher is auto-recovered
on both targets (emulator scenario in A1); everything documented in
boot-and-session.md + a new platform-health section.
```

## 8 — C1: Game-packaging ADR + hook injection

```text
TASK: Define the einky game-packaging convention and make the bundled game
follow it. Write meta/adr/0010-game-packaging.md covering:

- Layout: /data/games/<slug>/ containing a standard Ren'Py project (game/
  dir) plus inky-manifest.toml at the project root.
- Manifest schema v1: title, author, sort_key, cover (path), engine
  (min Ren'Py version), dither ("ordered"|"fs"|"threshold", see the e-ink
  playbook + D1), and text_scale hint (D2). Extend
  launcher/src/launcher/games/manifest.py — it is the current truth; keep
  unknown-key tolerance (forward compat) and add schema validation with
  clear log messages for authors.
- Hook delivery: games must NOT hand-vendor eink_hook.rpy / input_hook.rpy.
  Implement injection at scan/launch time: the launcher copies/refreshes the
  two hooks into <game>/game/ when (a) first seen and (b) the hook version
  changes (version marker comment in the file header). Canonical hook
  sources move to ONE shared location importable by both the launcher
  package and buildroot_os's post-build (which currently special-cases
  the_question via board/common/the_question-eink/) — likely shipped as
  launcher (or runtime) package data, since input_hook.rpy is generated from
  the contract and must stay in the gen_hardware.py --check parity loop.
- Cleanup: delete games/launcher (pre-ADR-0009 cruft); seed games/ with a
  README describing the convention for authors.

Then implement: injection in the launcher scan/launch path with tests, and
simplify buildroot_os post-build.sh to install stock game + manifest + eink
gui/options overrides only, letting injection add the hooks.

PITFALLS — think about these:
- input_hook.rpy is GENERATED from meta/shared/hardware.toml — moving its
  canonical home must keep the --check parity chain working (gen_hardware.py
  writes it; decide the new path and update the generator + check). Do not
  end up with two generated copies.
- Injection on a read-only medium: /data/games is writable (B1), but a game
  could be mounted read-only in the future (USB gadget) — injection must
  fail soft (log + skip) and the game then simply can't run; surface that in
  the library UI as "incompatible".
- .rpy vs .rpyc: Ren'Py compiles hooks on first run; when the hook version
  bumps, the stale .rpyc must not shadow the new .rpy — delete the matching
  .rpyc on refresh (and the game/cache/ bytecode dir if needed).
- Version detection: injecting at LAUNCH time (in GameSession.start before
  spawn) is more robust than at scan time (game may be added mid-session),
  but adds latency — it's a file copy, negligible; do it at launch, and at
  scan only for the "incompatible" flagging.
- Don't clobber author files: if a game ships its OWN eink_hook.rpy (old
  convention), overwrite only when our version marker is present or the
  file is byte-identical to a known old version; otherwise log loudly and
  skip (author knows better).
- the_question's e-ink gui.rpy/options.rpy overrides are game-specific
  content, NOT hooks — they stay in post-build; be precise in the ADR about
  the difference (hooks = transport, overrides = presentation).
- Slug rules: define allowed characters (dir name = slug = save dir name,
  B2) and enforce/sanitize in the scanner with tests.

DONE WHEN: the ADR is accepted and committed; hooks reach the_question via
the mechanism on the emulator image (A1 still passes, including input — which
proves the generated hook works); hook version bump refreshes stale copies
(test incl. .rpyc removal); games/launcher is deleted; game-author docs page
describes the convention.
```

## 9 — C2: e-ink game template + second title

```text
TASK: Create games/template-eink/ and a small second title from it.

Template — a minimal, immediately runnable Ren'Py project tuned for the
device (read docs/docs/software/eink-playbook.md first; the 1-bit UI rules
section is the spec):
- 800x480; pure high-contrast GUI: no gradients, no alpha blends over art,
  no hover states (there is no pointer), focus shown by INVERSION;
- ALL transitions None/instant (define config defaults: no dissolve, no
  fades, no ATL animation loops; with_statement callbacks or transition
  overrides so even author habits like `with dissolve` degrade to instant);
- Fonts: regular/medium+ weight at generous sizes (the playbook's font rule);
  gui.text_size et al read the launcher's text-scale hint env (D2) with a
  sane default when unset;
- e-ink game-menu screens (save/load/prefs/quit-to-library) shared with D3 —
  design them once here, D3 layers them onto bundled games;
- autosave configured per B2; no renpy.input() anywhere (no text entry on
  device — document the constraint for authors);
- inky-manifest.toml filled (incl. dither choice); cover.png sized for the
  library; NO vendored hook files (C1 injects them);
- author README: run on the desktop SDK (meta/scripts/install-renpy-sdk.sh),
  test on the emulator, what the seven buttons map to, art guidance
  (high-contrast art dithers well; midtone-heavy art turns to mush — advise
  testing every CG through tools' dither preview early).

Second title — a short original demo VN from the template (a few scenes, 2+
choices, art that dithers well) proving the template beyond the tutorial.

Wire both into the emulator image alongside the_question (seeded to
/data/games per B1) so the library shows 3 entries.

PITFALLS — think about these:
- Ren'Py's default screens are mouse/hover-centric: verify EVERY screen
  (save slots grid, prefs, confirm dialogs) is operable with d-pad focus
  movement only — focus_up/down/left/right events are what the buttons send;
  test slot navigation explicitly.
- The engine's default quick_menu / rollback-on-scrollwheel etc. assume
  inputs the device doesn't have — disable or remap deliberately.
- Image prediction/caching: big CGs at 800x480 on 512 MB with llvmpipe —
  keep art assets modest; respect the config.image_cache_size defaults from
  B4.
- Text speed/auto-advance: character-by-character text crawl generates a
  frame per character = refresh storm. Set instant text (config.default_text_cps=0)
  in the template — this is an e-ink requirement, not a preference.
- Save-slot screenshots at 1-bit: the engine screenshot is greyscale — it
  will be dithered by our pipeline only on the panel, but the SLOT thumbnails
  render inside the game; make sure slot screens look sane (they render
  through the same frame path, so mid-grey thumbnails dither — acceptable,
  but check).
- The demo's art must be original or clearly licensed — no scraped assets.

DONE WHEN: both new games boot, play, save/load, and exit via the seven
buttons only on the emulator; text renders instantly (no per-character
frames — assert frame counts in a test drive); the library shows 3 correct
entries; template + author docs published.
```

## 10 — C3: Sideloading

```text
TASK: Make "drop a game folder onto the SD card" a supported feature.

1. Rescan: the launcher picks up added/removed games without reboot — rescan
   on every library on_enter (verify current behaviour in screens/library.py
   and games/library.py; make it true if not). Empty library shows a helpful
   hint ("Add games to /data/games — see docs URL").
2. Robust scanning: a half-copied or invalid game dir (no game/ subdir,
   unreadable manifest, bad encoding, symlink loops, files-not-dirs) is
   skipped with a clear log line and never crashes the scan — unit tests
   with a zoo of malformed fixtures.
3. Validation UX: a recognizable-but-broken game (manifest parse error,
   failed hook injection per C1) appears greyed-out with a "problem" marker
   OR is hidden — decide, document, test. Greyed-out is friendlier (the user
   sees SOMETHING happened).
4. Docs: a user-facing sideload guide — power off, mount the SD data
   partition on a PC, copy the folder, eject cleanly (unclean eject = the
   half-copied case you tested), boot.
5. Stretch (only if time remains): prototype USB mass-storage gadget mode
   exposing the data partition (dwc2 + g_mass_storage / configfs) as a
   Pi-target option, OFF by default, documented as unvalidated-until-
   hardware.

PITFALLS — think about these:
- Rescan cost: scanning re-reads manifests and covers; the cover cache is
  keyed how? (check games/covers.py) — must not re-dither every cover on
  every library visit (SD reads + CPU); cache by content hash (NOT mtime —
  no RTC, B4) and test cache hits.
- A game REMOVED while it's the "last_played" hoist target — the ordering
  code must tolerate a missing slug (check order_games).
- A game removed WHILE RUNNING is undefined on Linux (open fds live on) —
  the session survives, but the exit flow back to the library must not
  crash on the missing dir; test.
- FAT vs ext4 for the data partition (B1 chose ext4): a PC can't mount ext4
  easily on Windows/macOS — this is a REAL product tension. Don't silently
  change B1: raise it in the PR, propose the resolution (exFAT data
  partition? a separate FAT "inbox" partition? USB gadget as the real
  answer?), and document the chosen tradeoff. This decision affects G.
- Unicode game folder names: slugs must sanitize (C1's rules) and the UI
  must render non-ASCII titles with the bundled font — test one.
- USB gadget stretch: dwc2 on the Zero 2 W's only USB port conflicts with
  any host-mode use and can't run while the partition is mounted rw by the
  OS (mass-storage exports the block device) — the design needs an
  export-mode (launcher screen: "USB transfer mode" that unmounts /data,
  exports, remounts on exit). Do not half-implement; if time is short,
  design-doc it and stop.

DONE WHEN: add/remove between library visits works on the emulator
(integration test + emulator scenario); the malformed-game zoo passes; the
ext4-vs-PC-mountability tension is resolved and documented; the sideload
guide is published.
```

## 11 — D1: Refresh & image-quality engine (F8 — the e-ink core)

```text
TASK: Implement docs/docs/software/eink-playbook.md's decision table as code.
This is the most e-ink-specific work in the project; read the playbook twice.

1. Frame dedup: hash the packed 48000-byte frame; byte-identical to the last
   SHOWN frame -> skip entirely (no SPI, no refresh, no ghost-budget spend).
   Applies to launcher frames and game frames alike (single choke point:
   the display path in launcher/src/launcher/app.py + session/receiver.py —
   consider unifying both through one FrameGate object).
2. Refresh policy v2 (replace display/refresh.py's naive counter):
   full on — screen/scene transitions (screens already signal want_full),
   game start/exit handoff, wake-from-sleep (D4 hook), changed-pixel ratio
   above a threshold (default ~40%, computed on the packed frames via XOR +
   popcount — numpy makes this cheap), ghost budget exhausted (count
   PARTIALS SHOWN, not frames received);
   partial otherwise; plus a user-facing "Clear screen" action (Settings)
   that forces a full refresh.
3. Dither stability: add ordered (Bayer 8x8 or blue-noise mask) dithering to
   runtime/src/frame_processor/dither.py alongside floyd_steinberg, selected
   per content: launcher UI stays threshold (already is, by construction);
   game frames default to ORDERED; per-game override via inky-manifest.toml
   dither key (C1) and a global Settings override (D2). Rationale: FS
   reshuffles noise globally on tiny input changes -> defeats dedup, defeats
   the diff threshold, sparkles under partial refresh (playbook).
4. Rate limiting: the game-frame receiver shows the NEWEST frame when the
   display is ready and drops intermediates — never queues. Respect
   [refresh] target_fps=2 as the pacing floor for game frames.

PITFALLS — think about these:
- This changes runtime (dither.py) AND launcher — the golden dither hashes
  in runtime/tests/golden and the launcher pack-parity test will need
  deliberate updates; regenerate goldens knowingly, and ADD a diff-locality
  test: flip 1 input pixel -> assert the ordered-dither output changes only
  within a small neighborhood (this is the property the whole design rests
  on; FS will fail it, which is the point — test FS's failure too as
  documentation).
- The changed-pixel ratio must compare LIKE WITH LIKE: two ordered-dithered
  frames compare meaningfully; an FS frame vs its successor always looks
  ~100% changed. Compute the ratio AFTER the dither stage, and only trust it
  under deterministic dithers (under FS, fall back to the counter policy —
  encode this in the policy object, tested).
- Dedup must key on the last frame SHOWN, not last received (a dropped
  intermediate must not poison the comparison).
- Thread-safety: receiver thread and main loop both reach the display — the
  FrameGate/backend must serialize (a lock around show()), and the "panel
  ready" signal on SPI is BUSY-driven while on tcp/png it's instant; model
  readiness in the backend interface (e.g. show() blocks briefly; receiver
  keeps only the newest pending frame in a 1-slot buffer).
- Wake/game-handoff full-refresh triggers come from OTHER steps (D4, session
  code) — expose a clean force_full() / note_transition() API rather than
  letting callers poke policy internals.
- target_fps pacing: do not sleep() the receiver thread into lag — pace by
  "if a frame arrived while busy, keep newest; show it when ready"; a
  monotonic clock floor only guards the pathological animating-game case.
- Settings interplay: full_refresh_every is user-tunable (existing setting)
  — policy v2 must keep honoring it live via ApplySettings.
- Keep PngBackend determinism for tests: dedup/skip changes how many files
  it writes — tests that count frames must be updated intentionally.

DONE WHEN: playbook decision table rows each map to a unit test; the
diff-locality property test passes for ordered and (expectedly) fails for FS;
an emulator scenario with an animating fake game shows drops-not-queueing
(bounded latency) and dedup on static screens (no traffic); goldens updated
deliberately; frame-pipeline.md + eink-playbook.md updated to "implemented".
```

## 12 — D2: Settings expansion (F6)

```text
TASK: Expand the launcher Settings to the F6 feature set, adapted honestly to
e-ink hardware.

1. Font size: a text-scale setting (small/medium/large) in SettingsStore,
   consumed by launcher/src/launcher/ui/theme.py so every screen scales;
   persists and applies live (ApplySettings pattern). Export the scale to
   games via GameSession's env (EINKY_TEXT_SCALE) for the C2 template's
   gui.rpy to consume (games may ignore it; document as a hint).
2. Display tuning: keep full_refresh_every; add the D1 dither-algorithm
   global override and a "Clear screen now" action (forces a full refresh —
   the e-reader ghost-clearing escape hatch).
3. About page: image version (bake /etc/inky-release into the image at build
   time — coordinate format with G), free space on /data, IP address when
   networked, and (if D5 landed) battery readout.
4. Brightness & volume: NOT APPLICABLE — the panel has no backlight, the
   device no audio path. Add the one-paragraph rationale to the settings
   docs and keep the F6 roadmap row reconciled. Do not add dead menu items.

PITFALLS — think about these:
- Text scaling breaks layouts: every screen with fixed boxes (library list
  rows, footer, status bar, keyboard grid) must reflow or clamp — audit
  ui/widgets.py geometry (row heights derived from font metrics, not
  constants), and add golden-frame tests at all three scales for the library
  and settings screens; ellipsize long titles at large scale.
- The on-screen keyboard (Wi-Fi) at large scale must still fit 800x480 with
  its grid navigable — test it.
- Live-apply of text scale changes the CURRENT screen's layout — re-render
  with full refresh (layout change per the playbook).
- Settings writes: respect B4's debounced store (no write per arrow press
  while the user cycles options).
- "Clear screen" must work IN the settings screen itself (a full refresh of
  the same content — the policy API from D1 exposes force_full()).
- /etc/inky-release lives on the read-only root (B1) — write it at image
  build (post-build.sh), not at runtime.
- Free-space on /data: statvfs, cheap; don't poll it per frame — compute on
  About enter.
- Games and EINKY_TEXT_SCALE: only NEW sessions see it (env at spawn) —
  that's fine; say so in the UI copy or docs ("applies to games on next
  launch").

DONE WHEN: three scales render correctly (goldens), all screens navigable at
all scales via buttons only, settings survive reboot (extend the existing
settings-flow integration test), About shows real values on the emulator, the
brightness/volume rationale is in the docs, and launcher.md documents the new
pages.
```

## 13 — D3: In-game menu + exact resume (F4, F10)

```text
TASK: Turn Ren'Py's game menu into the device's in-game menu, with verified
exact resume ("pop mode").

1. Screens: e-ink game-menu screens (save / load / preferences / quit-to-
   library) — designed once in the C2 template, layered onto bundled games
   via the shared overlay. Rules (playbook): pure black/white, no
   transparency over the paused scene (Ren'Py's default menu dims the
   background with alpha — replace with a SOLID panel; alpha over art
   dithers into noise), focus by inversion, d-pad + A/B only, B closes and
   resumes.
2. Quit to library: a menu item that cleanly ends the process (renpy.quit())
   -> the session's normal exit path returns to the library. rc must be 0
   (no "exited unexpectedly" error screen — check what renpy.quit() returns
   and what A3 pinned for rc==0 fast exits).
3. Exact resume: closing the menu returns to the exact interaction; loading
   a save restores the exact scene. Emulator/integration test: advance to a
   known scene -> open menu (b) -> save -> quit to library -> relaunch ->
   load -> assert the same frame (tolerant compare) as before saving.
4. Full button operability: save-slot grid, prefs, confirm dialogs — all
   navigable with focus events only; slot grid wrap-around behaviour defined
   and tested.

PITFALLS — think about these:
- The B button maps to game_menu — INSIDE the menu B must mean "back/close"
  (Ren'Py handles this natively, verify with our event mapping; the
  contract maps b -> game_menu which toggles).
- Opening the menu is a layout change -> full refresh; closing it back to
  the scene is too. Menu NAVIGATION (moving focus between slots) must be
  partial. This falls out of D1's policy only if the game's frames make it
  through the diff threshold correctly — with ordered dither this works;
  verify the interplay, don't assume.
- Hold-Start vs in-game menu quit: hold-Start (SIGTERM) remains the global
  escape hatch; the menu quit is the POLITE path (engine saves persistent
  data, syncs). Both must coexist; test both.
- Ren'Py autosaves on menu-open by default in some configs — with B2's
  autosave settings, opening the menu may write to /data every time;
  acceptable, but confirm frequency is sane (SD wear, B4).
- Save during the FIRST interaction (before any advance) and load from the
  main menu (not in-game) are edge paths players hit — test them.
- The "same frame after load" assertion: Ren'Py may re-randomize dither
  input? No — the scene renders deterministically, but timers/animations in
  a scene would differ; the test scene must be static (template guarantees
  no animation, use a template-based test scene).
- Preferences inside the game (text speed etc.) must not fight the
  template's e-ink-mandatory settings (instant text) — hide or clamp those
  prefs in the template's screens.

DONE WHEN: the scripted save->quit->relaunch->load->same-frame loop passes on
the emulator via buttons only; menu open/close refresh classes match the
playbook (asserted via the D1 policy's decisions in an integration test);
quit-to-library produces no error screen; game-author docs describe the menu
contract.
```

## 14 — D4: Sleep mode (F13)

```text
TASK: Implement inactivity sleep in the launcher (it owns the panel and the
buttons, so it owns sleep).

1. State machine (launcher/src/launcher/sleep.py or in app.py): after N
   minutes without ANY input event (setting "Sleep after": off/1/5/15 min,
   default 5), enter SLEEP:
   - render a dedicated sleep frame (e-ink holds it at zero panel power —
     show something useful: "sleeping" + maybe the game title),
   - full refresh it, then deep-sleep the panel (SpiBackend -> Panel.sleep();
     define the tcp/png backend equivalent as a no-op marker the tests can
     observe),
   - stop pushing frames (gate in the D1 FrameGate) and stop forwarding
     input to a running game.
   Any button press wakes: re-init the panel (SpiBackend must re-run init),
   force a full refresh of the current content (D1's force_full/wake hook),
   and SWALLOW that press (it must not also act on the UI/game).
2. In-game: same trigger (input flows through the launcher, so it can tell);
   the game process keeps running underneath. Stretch, config-gated default
   OFF: SIGSTOP the game's process group on sleep / SIGCONT on wake to cut
   CPU (llvmpipe idles anyway when Ren'Py waits for input, so measure
   whether it's worth the risk).
3. Timer design: inject a clock (time.monotonic wrapped) — tests must not
   sleep for minutes; the main loop's queue.get timeout (added in B4 for
   the heartbeat) is the natural tick source. Never wall-clock (B4: no RTC).
4. SoC suspend is OUT of scope (hardware-dependent): leave a documented,
   env-gated hook (command to run on entering sleep) for Phase F.

PITFALLS — think about these:
- Frames arriving WHILE asleep (an animating game): the receiver must drop
  them silently without waking the panel; on wake, the NEWEST frame renders
  (D1's 1-slot buffer gives this for free — integrate, don't duplicate).
- Race: a button press exactly while entering sleep — serialize state
  transitions through the main loop (events), not flags set from threads.
- The swallowed wake press: swallow BUTTON events, but a hold:start during
  sleep should probably wake AND be swallowed (not exit the game) — decide,
  document, test.
- Panel re-init after deep sleep is mandatory (playbook symptom table:
  "fine after boot, dead after idle") — the SpiBackend needs an explicit
  wake()/reinit path; on tcp/png backends make wake observable for tests.
- SIGSTOP stretch: a SIGSTOPped Ren'Py stops serving its input socket —
  forward-after-wake must tolerate the reconnect (the sender already
  retries); also SIGSTOP'd children can't handle SIGTERM — the exit combo
  during sleep must SIGCONT first. This is why the stretch is config-gated
  off.
- Sleep during the STARTING screen / during game spawn: simplest correct
  rule is "inactivity timer resets on any state transition and doesn't run
  while a session is starting" — implement and test.
- Setting "off" must fully disable the timer (no spurious ticks), and
  changing the setting applies live (ApplySettings pattern).

DONE WHEN: on the emulator with a short timeout (env override), inactivity
produces the sleep frame then silence on :5333; frames from an animating fake
game are dropped while asleep; a press wakes with exactly one full refresh
and is swallowed; menu and in-game paths both tested; panel sleep()/init()
call order asserted with a fake backend; docs updated (launcher.md,
boot-and-session.md, eink-playbook.md wake rule).
```

## 15 — D5: Battery status (F11, software half)

```text
TASK: Build the battery-status feature against an abstraction, since the BOM
has no fuel gauge yet (bare Li-Ion pack; IP5306 planned, basic variant has no
telemetry).

1. BatteryProvider protocol (launcher/src/launcher/settings/battery.py,
   mirroring the wifi backend pattern): available() -> bool,
   percent() -> int|None, charging() -> bool|None. Backends:
   - MockProvider (EINKY_BATTERY_BACKEND=mock): level scriptable via env or
     a file the emulator/tests can rewrite, so the UI can be driven through
     full/low/critical;
   - SysfsProvider: reads /sys/class/power_supply/*/capacity,status —
     dormant until real hardware provides a kernel driver (the D5 ADR
     decides which); write it now against the standard sysfs ABI;
   - NullProvider: no battery info -> feature hidden entirely.
2. UI: battery glyph + percent in the StatusBar (design 1-bit glyphs that
   read at ALL D2 font scales); About-page readout; low-battery warning
   dialog at a threshold (setting, default 15%); automatic CLEAN shutdown at
   a critical threshold (default 5%) reusing the existing power path (panel
   deep-sleep first) — thresholds active only when a provider is available.
3. Polling: a slow timer (>= 30 s; reuse the main-loop tick from B4/D4) —
   never per-frame; a battery % change alone should NOT trigger a panel
   refresh unless the glyph actually changes at the current quantization
   (e.g. 25% steps) — dedup handles the rest (D1).
4. Hardware decision: draft meta/adr/0011-battery-telemetry.md comparing an
   I2C fuel gauge (MAX17048-class), the IP5306 I2C variant, and an external
   ADC, with a recommendation, the kernel/driver implications for
   SysfsProvider, and the case/wiring impact (coordinate with the `case`
   repo's BOM). Validation is deferred to Phase F.

PITFALLS — think about these:
- Percent quantization vs refresh discipline: the status bar must not cause
  partial refreshes every poll — quantize the glyph (e.g. 5 bars) and rely
  on frame dedup; test that a 1% change produces zero panel traffic.
- Critical shutdown mid-game: go through the polite path (SIGTERM the game
  so Ren'Py saves persistent data, then poweroff) with a short deadline —
  reuse session teardown, don't yank power in software while a save might
  be writing (B2 sync discipline).
- Hysteresis: a sagging Li-Ion voltage under load (refresh spikes!) can
  bounce across thresholds — require the level to hold below threshold for
  N consecutive polls before acting; this is exactly how the real hardware
  will behave, encode it now in the provider-consumer, test with the mock.
- charging() unknown (None) is a valid state — UI must render "unknown"
  gracefully, not crash or show 0%.
- Don't block the main loop on sysfs reads (they're fast, but a broken
  kernel driver can stall) — read with a guard or in the tick with a
  try/except + NullProvider degradation after repeated failures.
- The low-battery dialog during sleep (D4): waking the panel to show a
  warning is CORRECT for critical (about to shut down) but wrong for the
  15% nag — define the interaction (critical wakes + shuts down cleanly;
  low waits until the next wake), test both.

DONE WHEN: the emulator shows a scripted level in the status bar at all font
scales; low + critical flows pass integration tests (critical asserts the
clean-shutdown path incl. session teardown, mocked power); 1%-change-no-
refresh test passes; the ADR draft is committed; docs updated.
```

## 16 — E1: Bring-up runbook + flip-point switches

```text
TASK: Write the hardware bring-up runbook and guarantee every bring-up
variable is switchable WITHOUT rebuilding the image.

1. Verify (and fix where untrue) that these are runtime-switchable via
   /etc/default/inky-session or kernel cmdline, not compile-time:
   EINKY_INVERT_FRAME (frame polarity), EINKY_GPIOCHIP (gpiochip index),
   BUSY polarity (check runtime/src/spi_driver/spi_driver.c — if hard-coded,
   add EINKY_BUSY_ACTIVE_LOW), SPI bus speed (add EINKY_SPI_HZ if fixed),
   RST pulse timing if marginal, GPIOZERO_PIN_FACTORY, EINKY_SPI_DEV.
   Small runtime/ changes are in scope; the generated contract.h values stay
   the DEFAULTS (env only overrides).
2. Write docs/docs/hardware/bring-up.md as an ordered checklist an engineer
   with the board and NO project context can execute:
   serial adapter wiring (pins, 115200) -> expected boot output landmarks ->
   login -> `glxinfo | grep llvmpipe` -> panel power/wiring sanity (3.3V!
   the panel is NOT 5V tolerant) -> first init log lines -> first full
   refresh -> the flip-point TRIAGE TABLE (symptom -> switch: inverted
   image, mirrored image, no BUSY release/hang, wrong gpiochip, dead SPI,
   partial refresh artifacts) -> buttons (gpioinfo, evtest-equivalent, then
   launcher log) -> full session -> Wi-Fi (E3) -> shutdown + panel-sleep
   check -> where every log lives.
   Reuse the symptom table from docs/docs/software/eink-playbook.md — link,
   don't duplicate.
3. Each flip-point documented with: what it changes, how to flip it on a
   BOOTED device (mount SD boot partition / edit /etc/default via serial),
   and how to make it permanent (contract or overlay).

PITFALLS — think about these:
- The whole value of this step is NO-REBUILD iteration: flipping a value
  must take effect with `/etc/init.d/S95inky-session restart`, not a
  reflash. Test each env knob END-TO-END on the emulator where observable
  (EINKY_INVERT_FRAME must visibly invert the tcp preview — if the invert
  currently lives only in the C driver, add it to the shared pipeline level
  so all backends honor it and the emulator can prove it).
- /etc/default/inky-session sits on the (soon read-only, B1) rootfs — the
  runbook needs the remount-rw incantation, or better: source an optional
  /data/inky-session.local override AFTER the target file (implement this;
  it also helps field debugging forever).
- gpiozero + libgpiod both touch GPIO (buttons via RPi.GPIO pin factory,
  panel DC/RST/BUSY via libgpiod in the C driver) — different pins, but
  document the split and the "GPIO busy" failure mode if a pin overlaps by
  contract mistake.
- The C driver claims lines via libgpiod v1 API — gpiochip numbering can
  shift between kernel versions (hence EINKY_GPIOCHIP); the runbook's
  gpioinfo step must show how to identify the right chip.
- BUSY-timeout behaviour (from E2) is what turns "wrong polarity" from a
  hang into a readable error — if E2 hasn't landed yet, note the dependency
  prominently in the runbook.

DONE WHEN: every flip-point is demonstrably env-switchable (emulator-visible
ones proven in tests, driver-level ones unit-tested via the E2 harness or a
fake), the /data local-override mechanism works, and the runbook is complete
enough for a cold engineer — reviewed against the playbook's symptom table.
```

## 17 — E2: SPI driver desk-check + fake-bus harness

```text
TASK: De-risk the GDEM0397T81P C driver before any board exists.

1. Desk-check: obtain the GoodDisplay GDEM0397T81P datasheet/demo code and
   the GxEPD2 driver for this panel class (research online; cite sources in
   the findings doc). Compare against runtime/src/spi_driver/spi_driver.c:
   power-on/reset sequence (RST pulse widths, post-reset delays), init
   command table, RAM write commands + address windowing, partial vs full
   refresh command/LUT selection, BUSY semantics per operation, deep-sleep
   entry, and the invert convention (contract: packed bit 1 = white; panel
   draws bit 1 as black -> driver must invert; verify it does, once, in
   exactly one place).
   Produce a findings table: sequence | ours | reference | verdict/fix.
   Apply unambiguous fixes; ambiguous ones become named flip-points (E1).
2. Fake-bus harness: a test build where spidev writes/ioctls and gpiod line
   operations are RECORDED instead of executed (link seam or #ifdef'd
   backend in the CFFI build — pure software, buildable on the host/CI).
   Unit tests assert, for init/partial/full/sleep:
   - exact command-byte sequences (from the desk-check's blessed reference),
   - DC line state around command vs data phases,
   - RST timing ordering (can assert sequence, not real durations),
   - BUSY polled between operations WITH A TIMEOUT — and add the timeout if
     missing: a stuck BUSY must return an error code, never hang (this is
     load-bearing for the whole launcher: a hang here freezes the UI and
     only B4's watchdog would save it),
   - frame size validation (reject != 48000 bytes with an error, not a
     buffer overrun — check the C code's bounds handling!),
   - EINKY_INVERT_FRAME behaviour.
3. Wire into runtime `make test` (skip cleanly when the C extension can't
   build).

PITFALLS — think about these:
- The datasheet's controller matters more than the panel marketing name —
  identify the actual controller (UC8179? SSD16xx? JD79686?) from the
  GoodDisplay docs and match command sets against THAT; GxEPD2's class
  hierarchy tells you which family it treats this panel as.
- Partial refresh on this class typically requires writing BOTH RAM buffers
  (previous + current image) or a specific "write RAM red/old" step —
  getting this wrong produces the classic "partial refresh shows nothing/
  garbage" bring-up failure; scrutinize it hardest.
- Deep-sleep entry usually requires a re-INIT (full reset) to wake — confirm
  the driver's wake path does a full init (D4 depends on this).
- The C code runs as root against /dev/spidev with user-supplied frame
  buffers via CFFI — audit lengths/casts (a Python bytes of wrong length
  must be rejected at the Python wrapper AND the C layer).
- Don't let the harness drift from production code: the recording backend
  must wrap the SAME functions the real build uses (one #ifdef at the
  syscall boundary), or the tests test nothing.
- Windowed partial update (playbook open question): while you're in the
  datasheet, ANSWER it — does the controller support partial window
  addressing? Document yes/no + the commands; D1 v2 can exploit it later.

DONE WHEN: the findings table is committed (docs/ or runtime/docs/), sequence
tests pin init/partial/full/sleep against the blessed reference, BUSY timeout
+ frame-size validation exist and are tested, the invert happens exactly once
and is proven, and the windowed-partial question is answered in the playbook.
```

## 18 — E3: Wi-Fi boot service finalisation

```text
TASK: Finalise the Pi image's Wi-Fi plumbing so the launcher's WpaCliBackend
finds a working daemon on hardware day.

1. Boot service: an init script (S4x, Pi target only) starting
   wpa_supplicant on wlan0 with its config on /data (survives reflash, B1;
   created from a template on first boot), control interface where wpa_cli
   expects it (/var/run/wpa_supplicant); udhcpc hooked to association
   events (wpa_cli -a action script), not blind-looped.
2. Regulatory domain: a country knob in /etc/default (or /data override,
   E1), applied via wpa_supplicant config (country=) — required for legal
   channel use; document the default and how users change it.
3. Verify the launcher side against the SHIPPED wpa_supplicant version:
   WpaCliBackend's call sequence (scan/scan_results/add_network/set_network/
   enable_network/save_config/status) and its parsers — unit tests with
   captured real-format outputs (get them from the wpa_supplicant source's
   docs/tests for the pinned version).
4. Emulator validation (no wlan0 in virt): the service must start and idle
   or exit cleanly with no boot delay and no log spam; the launcher shows
   "Wi-Fi unavailable" (NullBackend auto-select); EINKY_WIFI_BACKEND=mock
   still drives the full UI flow (existing tests keep passing).
5. Time sync tie-in: when association succeeds, kick B4's ntpd (or rely on
   its own retry) — document the interaction.

PITFALLS — think about these:
- brcmfmac firmware loading is the classic Pi Wi-Fi failure: the defconfig
  already ships BR2_PACKAGE_LINUX_FIRMWARE_RPIDISTRO_BCM43XXX — verify the
  exact firmware+NVRAM filenames the Zero 2 W's BCM43436 wants end up in
  /lib/firmware/brcm/ in the built image (inspect output/target), because a
  missing .txt NVRAM file fails silently with a dead wlan0.
- wpa_supplicant.conf holds the passphrase in plaintext on /data — add
  update_config=1 (wpa_cli save_config needs it), chmod 600, and a privacy
  note in the docs.
- The launcher's connect flow is SYNCHRONOUS in a screen (settings/wifi.py)
  — with a real daemon, scan+associate+DHCP can take 15-30 s; ensure the
  timeout budget and the "Connecting..." rendering hold up, and that B4's
  watchdog (if landed) doesn't kill the launcher during it — coordinate the
  exemption explicitly.
- Do not start wpa_supplicant on the QEMU target at all (no wlan0): gate the
  init script on interface existence, not on target, so it also behaves on
  a Pi with a dead radio.
- 2.4 GHz only on the Zero 2 W — scanning code must not assume 5 GHz fields;
  parser tests should include an open network, WPA2, hidden SSID, and
  non-ASCII SSID (bytes! wpa_cli escapes them — parse the escaping).
- Boot ordering: wpa needs /var/run (tmpfs, B1) and /data mounted; S4x
  number accordingly; it must NOT delay S95inky-session (launcher boots
  regardless of Wi-Fi state — that's the appliance contract).

DONE WHEN: the Pi image builds with the service enabled and correctly gated;
the emulator boots with zero regression (A1) and clean "Wi-Fi unavailable"
behaviour; parser unit tests cover the captured-output zoo (incl. non-ASCII
SSIDs); the firmware files are verified present in the built image (add a
build-time check); docs updated (settings page + E1 runbook Wi-Fi step +
privacy note).
```

## 19 — F: Hardware bring-up (requires the board)

```text
TASK: Execute docs/docs/hardware/bring-up.md on the physical device and drive
every deviation back into code/docs.

Follow the runbook in order: flash -> serial boot -> glxinfo/llvmpipe ->
panel first light -> settle the flip-points (record FINAL values:
EINKY_INVERT_FRAME, EINKY_GPIOCHIP, BUSY polarity, SPI speed, pin factory) ->
buttons (debounce feel: 30 ms from the contract — adjust there if real
switches bounce worse) -> full session on glass -> refresh & ghosting tuning
BY EYE (this is the one thing emulation cannot do):
  - measured full/partial refresh times -> update the playbook's numbers,
  - real ghost accumulation -> settle full_refresh_every's default (contract
    [refresh]) and D1's changed-pixel threshold,
  - dither quality of real game art on real glass -> revisit the D1 default
    (ordered vs FS for stills),
  - partial-refresh artifact patterns -> feed the symptom table
-> Wi-Fi join on a real AP (E3) -> shutdown + panel-protection check ->
sleep-mode behaviour + measured idle power draw (D4; decide the SoC-suspend
hook) -> battery telemetry hardware if fitted (D5 ADR) -> battery runtime
measurement under play.

RULES: for every deviation fix the DEFAULT in the right layer (contract >
runtime > board overlay), never a one-off image tweak; every flip flipped
must end as a committed default; keep a dated bring-up log in docs/ (board
rev, findings, measurements); anything that surprises you goes into the
playbook's symptom table for the next person.

PITFALLS — think about these:
- Undervoltage is the great impostor: SD corruption, random resets, and
  "software bugs" that are really a weak supply — use a known-good 5V/2.5A+
  supply before trusting any failure, and check the kernel's undervoltage
  reports early.
- Wire the panel at 3.3V logic only; double-check DIN/CLK/CS/DC/RST/BUSY
  against docs/docs/hardware/wiring.md BEFORE power-on (the table is
  generated from the contract — trust it over memory).
- First panel test: run the standalone splash/driver path (B3/E2) before
  the full stack — fewer moving parts than launcher+game.
- gpiozero's rpigpio pin factory needs /dev/gpiomem permissions (running as
  root, fine) but can conflict with other GPIO users — if buttons misbehave
  while the panel works, check the chip/line claims (gpioinfo).
- Thermals: llvmpipe pegs cores; in an enclosure, watch throttling
  (vcgencmd/sysfs thermal) during a long session — note it for the case
  repo.
- Keep the QEMU image in sync: any default changed during bring-up must
  still pass A1 (run CI before merging each bring-up fix).

DONE WHEN: a freshly flashed card boots to the launcher and plays a game
hands-off on the real panel with real buttons; all flip-point finals are
committed as defaults with the env overrides still available; the playbook's
timing/ghosting numbers are real measurements; the bring-up log is published.
```

## 20 — G: Release engineering & update story

```text
TASK: Make shipping images a repeatable, versioned process.

1. Versioning: define the InkyOS release scheme (semver or date-based);
   bake it into /etc/inky-release at image build (post-build.sh reads a
   VERSION file / git describe) — Settings > About (D2) displays it;
   coordinated git tags across buildroot_os/runtime/launcher per release
   (the image build pins the two repos — a release tag records the triple).
2. CI release job (extends A2): on tag, build the Pi sdcard.img + the QEMU
   image, generate SHA256SUMS, attach both + the flashing guide as release
   artifacts. The Pi artifact is compressed (img.xz — dd/flash tools handle
   it; document both dd and Raspberry Pi Imager / balenaEtcher paths).
3. First boot: expand the /data partition + filesystem to fill the SD card
   (one-shot init step, marker file on /data when done; reuse B1's
   mkfs-if-blank logic). Test the mechanism in QEMU with an oversized disk
   image.
4. Update story (small ADR): official v1 = "reflash the rootfs partition,
   /data survives" (true since B1 — write the exact user procedure and TEST
   it: old-version /data + new rootfs must boot and migrate). Explicitly
   defer A/B slots; note what would trigger revisiting (OTA needs).
5. Housekeeping: the archived os/ pi-gen repo gets a final deprecation
   README pointing at buildroot_os; docs Downloads/Install page for
   end users.

PITFALLS — think about these:
- Settings/schema migration: a new launcher reading an OLD /data
  (settings.json schema, cover-cache format, save layouts) must upgrade or
  tolerate gracefully — add a schema_version to settings.json NOW (if D2
  hasn't already) and a migration test (old fixture -> new code).
- Reproducibility: two builds of the same tag should be functionally
  identical — Buildroot is mostly reproducible but timestamps creep in;
  don't chase bit-perfect, DO pin everything (the OVERRIDE_SRCDIR dev path
  must be OFF for release builds — releases build from the pinned tags;
  make the release job verify that).
- Expand-on-first-boot must be power-cut safe: resize2fs interrupted on
  first boot must not brick /data — order it (partition table first, marker
  before fs grow? research resize2fs crash-safety) and test a kill during
  expansion in QEMU.
- img.xz + first-boot expansion interact: the partition table in the image
  has the small /data — the expansion step rewrites it; make sure the boot
  still works when a user's card is EXACTLY the image size (no room to
  grow — expansion must no-op cleanly).
- Version display vs cache: /etc/inky-release on the ro rootfs is the truth;
  never cache it to /data.
- The release flashing guide must carry the "check /dev/sdX twice" warning
  and prefer Imager/Etcher for non-experts.

DONE WHEN: tagging produces downloadable, checksummed, compressed images +
guides with no manual steps; first boot fills any card size (tested oversized
+ exact-size in QEMU, incl. a mid-expansion kill); the reflash-update
procedure is documented and exercised once in the emulator (old /data + new
rootfs); the deprecation README is in os/; docs Downloads page published.
```
