---
sidebar_position: 4
---

# InkyOS build system

`buildroot_os/` is a Buildroot **`br2-external`** tree: Buildroot itself is a
pinned git submodule that is never edited; every einky customization lives in
the external tree (packages, board files, defconfigs). The build runs inside a
pinned Debian Bookworm **Docker container** (`./br.sh`), so the host distro is
irrelevant; QEMU runs on the host against the artifacts in the mounted output
directory.

## Entry points

| Command | What it does |
|---|---|
| `./build.sh qemu` | build the **emulator** target → `output-qemu/` |
| `./build.sh pi` | build the **hardware** target → `output/images/sdcard.img` |
| `./build.sh <t> <make-args>` | pass-through (e.g. `menuconfig`, `renpy-rebuild`) |
| `./run-qemu.sh` | boot the emulator image headless (serial console) |
| `./run-emulator.sh` | boot QEMU **and** open the Tk e-ink preview + gamepad window |
| `./br.sh …` | the underlying containerized Buildroot wrapper (`INKY_OUT` picks the output dir) |

`br.sh` also runs `scripts/gen_hardware.py --check` before each build, failing
on drift between the committed generated files and `meta/shared/hardware.toml`
(when the sibling `meta` checkout is present).

## Two targets, one stack

| | `inky_defconfig` (hardware) | `inky_qemu_defconfig` (emulator) |
|---|---|---|
| Base | Pi Zero 2 W (raspberrypi/linux kernel, bcm2711, rpi-firmware) | `qemu_aarch64_virt` (mainline kernel, virtio) |
| Toolchain | Bootlin external aarch64 glibc | Buildroot internal |
| Boot output | SD image with FAT boot + ext4 root (genimage) | `Image` + `rootfs.ext4` for `qemu-system-aarch64 -M virt` |
| Backend selection (overlay) | `EINKY_DISPLAY_BACKEND=spi`, `EINKY_INPUT_SOURCE=gpio` | `tcp` / `tcp` + `EINKY_WIFI_BACKEND=mock` |
| Extra hardware bits | `config.txt` (SPI on, button pull-ups — generated), Wi-Fi firmware + `wpa_supplicant` | host-forwarded TCP :5333/:5334 |
| Validates | kernel/boot chain, GPIO, SPI, panel, Wi-Fi | everything software: init, GL, Ren'Py, launcher, session, pipeline |

Both carry the identical software stack: **Mesa `llvmpipe`** (software desktop
GL — the engine needs GLX, which the Pi GPU can't provide) + **Xvfb** +
**Python 3** + **Ren'Py from source** + `inky-runtime` + `inky-launcher` +
`inky-session`. *Develop against the emulator, validate against hardware.*

## The einky packages

| Package | Type | Notes |
|---|---|---|
| `package/renpy` | source build of the pinned engine | driven by the engine's own `setup.py` with cross host-Cython; installs to `/opt/renpy`; carries **one patch** (`0001-add-eink-push-callback.patch`); build fails unless the compiled modules are aarch64. Needs SDL2 with X11+OpenGL, `python-ecdsa`, and Python's `zlib`/`unicodedata`. |
| `package/pygame-sdl2` | packaged but **unused** | Ren'Py 8.5.2 vendors its own `renpy.pygame`; kept for reference. |
| `package/inky-runtime` | PEP 517 Python package from the `runtime` repo | on the Pi target (`…_SPI=y`) also cross-compiles the CFFI `_spi_driver` extension against `libgpiod`, with an aarch64 format guard. |
| `package/inky-launcher` | PEP 517 Python package from the `launcher` repo | depends on `inky-runtime` + Pillow. |
| `package/inky-session` | local files only | installs the supervisor + `S95inky-session` init script. |

**Local-source development:** the launcher/runtime repos are pinned by
commit/tag for provenance, but `./br.sh` mounts the sibling checkouts and passes
`INKY_*_OVERRIDE_SRCDIR`, so day-to-day builds use your working tree
(Buildroot's standard `OVERRIDE_SRCDIR` rsync flow — venvs/caches excluded).

## Image assembly details

- `board/common/post-build.sh` (all targets): removes Buildroot's stock
  `S40xorg` autostart, and assembles `/opt/games/the_question` = the stock
  tutorial game from the Ren'Py source tree **+** the InkyOS deltas in
  `board/common/the_question-eink/game/` (`eink_hook.rpy`, generated
  `input_hook.rpy`, e-ink `gui.rpy`/`options.rpy`) **+** an
  `inky-manifest.toml`. The game is never vendored in git.
- `board/inky/sync-config-txt.sh` (Pi, post-image, runs *before* the rpi
  genimage step): re-copies `config.txt` into the boot partition on every image
  build so a regenerated contract can never ship stale.
- Rootfs is ext4, sized 1 G (emulator) / 1200 M (Pi) — Mesa+LLVM is the bulk.
- Caches: `.dl/` (downloads) and `.ccache/` persist across container runs.

## Pinned versions

Single source of truth: `meta/versions.env` (CI parity-checks the Buildroot
mirrors of these pins).

| Component | Version |
|---|---|
| Buildroot | 2026.05 (submodule) |
| Target Python | 3.14.5 |
| Host Cython | 3.1.3 |
| Ren'Py | 8.5.2 (same tarball series as the workstation SDK) |
| pygame_sdl2 | renpy-8.5.2.26010301 (packaged, unused) |

## The emulator dev loop

```bash
./build.sh qemu          # ≈ full build the first time; incremental after
./run-emulator.sh        # QEMU (serial console in the terminal)
                         # + Tk e-ink preview & gamepad window
```

The `virt` machine has no panel or GPIO, so the launcher runs with
`EINKY_DISPLAY_BACKEND=tcp` / `EINKY_INPUT_SOURCE=tcp`; QEMU forwards guest
:5333/:5334 to localhost and `launcher/tools/dev_preview.py` renders the frame
stream (arrows/wasd move, `j`=A, `k`=B, Enter=Start, `h`=hold-Start). Login on
serial: `root`, no password; quit with `Ctrl-A X`.

Useful inner loops:

```bash
./build.sh qemu inky-launcher-rebuild   # repackage the launcher from ../launcher
./build.sh qemu inky-runtime-rebuild    # repackage the runtime
./build.sh qemu renpy-rebuild           # recompile the engine
NO_PREVIEW=1 ./run-emulator.sh          # headless (same as ./run-qemu.sh)
```

(Config-only changes don't rebuild a package — use `<pkg>-dirclean` first when
toggling package sub-options.)

## Automated acceptance test

`tests/e2e_emulator.py` (run it with `make e2e`, or `./run-e2e.sh`) is the
unattended end-to-end test for the emulator image. It boots the image with the
**exact** `run-qemu.sh` command — `virt`, `-m 512` (kept deliberately so a
memory regression fails here), host-forwarded frame/input ports — then drives a
full session over the two TCP sockets and asserts, in order:

1. **boot** — the launcher's first frame arrives on `:5333` and matches the
   committed golden `tests/goldens/library_first_frame.bin` (the library home
   screen; deterministic because the fonts are baked into the image and it shows
   no clock/battery);
2. **input** — a button round-trips (`Start` opens Settings, `B` returns to the
   same golden);
3. **game** — launching `the_question` hands the panel to the game; frames start
   flowing and differ from the library. Game frames are dithered photos, so they
   are checked by **invariants** (`>25 %` black, not equal to a launcher frame)
   rather than a brittle exact golden;
4. **session** — `down`+`start` begin the story, `a` advances dialogue, `b`
   opens/closes the in-game menu, and the **hold:start** combo exits back to the
   library golden;
5. **reboot** — `Settings ▸ Power ▸ Restart ▸ Confirm` really reboots the VM
   (`EINKY_ALLOW_POWER=1` in the emulator overlay) and the launcher comes back
   with the same golden.

The frame/input wire clients come from `../launcher/tools/frame_stream.py` — the
single implementation of the [frame-pipeline](./frame-pipeline.md) preview
protocol, shared with `dev_preview.py`, so the byte format is never re-derived.

There are **no fixed sleeps**: every wait is a poll against a deadline. Ren'Py's
cold start under `llvmpipe` on 512 MB takes tens of seconds to a couple of
minutes and the first in-game inputs carry a JIT-warmup tail, so the deadlines
are generous and env-overridable (`EINKY_E2E_*_TIMEOUT`; see the buildroot_os
README). The frame connection drops and reconnects across the game handoff and
the reboot — the client retries transparently. On success the test prints one
stable `E2E_METRICS result=PASS …` line (boot-to-first-frame,
boot-to-interactive, …) for CI to track; on failure it exits non-zero and saves
the offending frame + guest serial log under `tests/.artifacts/`.

Regenerate the golden deliberately after an intended UI change, eyeballing the
printed changed-pixel/diff summary: `make e2e-bless`.

## Known build gotchas

See the [buildroot_os README troubleshooting table](https://github.com/einky/buildroot_os#troubleshooting)
for the full list — highlights: SDL2 must have `_X11` + `_OPENGL` or Ren'Py
dies with *"No available video device"*; the benign `gles2` failure line before
`gl2`/llvmpipe comes up; kernel tarball download throttling; and the raspi QEMU
machine being unusable (always use the `virt` target for emulation).
