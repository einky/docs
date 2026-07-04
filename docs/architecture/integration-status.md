---
sidebar_position: 2
---

# Integration status & roadmap

:::warning Reality check
The [Architecture Overview](./overview) describes the **target** design and
writes much of it in the present tense ("`buildroot_os` consumes `runtime`…",
"Ren'Py renders the launcher…"). This page records what is **actually wired
today** versus what is still planned, so the gap is visible and ownable. It was
produced from a direct audit of the repos on disk, not from the other docs.

**Refreshed 2026-07-04:** the `inky-runtime` package now exists and is consumed,
so the frame pipeline + input bridge run end-to-end on the emulator, and the Pi
`inky_defconfig` has been brought to parity — it boots straight into the game and
drives the panel over SPI + the `libgpiod` C driver (pending on-board validation).
The historical "gap" narrative below is kept for context; the TL;DR, per-repo
table, and phases have been updated to the current state.
:::

## TL;DR

| Question | Answer |
|---|---|
| Is **`runtime`** used by the OS today? | **Yes.** `buildroot_os` builds it as the `inky-runtime` Buildroot package and `inky-session` runs its console scripts: the full e-ink path (PNG capture hook → dither → 1-bit → dispatch) and the GPIO/keymap input bridge. The emulator drives the socket/TCP preview backend; the Pi target drives the GDEM0397T81P over SPI + the `libgpiod` C driver. |
| Is **`runtime`** useful to the project? | **Yes — it is the on-device engine of the appliance.** The only implementation of the e-ink frame pipeline, the GPIO handler, and the C SPI driver for the GDEM0397T81P panel. (The ESP32 firmware in it is a retired bring-up bridge.) |
| Is the **`games`** repo used by the OS? | **Not as a repo.** The OS assembles `the_question` at build time — the stock game from the `renpy` source tree plus the InkyOS deltas in `board/common/the_question-eink/` (the two hooks + e-ink gui/options), layered on by `board/common/post-build.sh`. Not vendored in git, not pulled from `games/`. |
| Is **`games`** useful as-is? | **Low.** `the_question` is the upstream Ren'Py tutorial — a test fixture, not an einky title. `games/launcher/` is a misfiled Ren'Py SDK project browser that [ADR 0008](https://github.com/einky/meta/blob/main/adr/0008-shared-hardware-contract.md) says to delete. |

## What actually boots today (emulator path)

`inky_qemu_defconfig` produces an image that:

1. Boots BusyBox init → `S95inky-session` → `inky-session.sh`.
2. Brings up **Xvfb** (`:0`, `-fbdir /run` so the framebuffer is an XWD file).
3. Supervises **Ren'Py** (built from source, `/opt/renpy`) running the vendored
   **`the_question`** at `/opt/the_question`, restarting it on exit.
4. The engine renders into Xvfb on Mesa `llvmpipe` software desktop GL.

The end-to-end path is now wired too, through the `inky-runtime` package that
`inky-session` starts:

- **Frame consumer.** `eink_hook.rpy` pushes one PNG per stable frame to
  `RENPY_EINK_SOCKET`; `inky-eink-receiver` (runtime's
  `frame_processor.eink_receiver`) consumes it, dithers to 1-bit, and dispatches
  it — to the TCP/socket **preview** on the emulator, or to the **GDEM0397T81P
  over SPI** on the Pi.
- **Input source.** `input_hook.rpy` binds `RENPY_INPUT_SOCKET`; on the emulator
  runtime's `net_sender` feeds it button names, and on the Pi `inky-input`
  (gpiozero → `xdotool`) injects the mapped keysyms. The button-name table is
  generated from `meta/shared/hardware.toml`, not hand-listed.
- So the emulator now runs the **whole pipeline** (render → capture → dither →
  dispatch → preview), and the Pi target (`inky_defconfig`, below) extends it to a
  real panel + buttons — pending physical-hardware validation.

## The integration gap (root cause)

[ADR 0008](https://github.com/einky/meta/blob/main/adr/0008-shared-hardware-contract.md)
diagnosed the original drift: shared logic was implemented several times. The
decision was "**one owner**: the frame pipeline + SPI driver + keymap live in
`runtime`; `buildroot_os` consumes it as the `inky-runtime` Buildroot package."
**That package now exists** (`package/inky-runtime/`) and is consumed, so the gap
described below is largely closed. The two subsections are kept as history of the
original state:

### 1. `runtime` was not packaged into the OS — now fixed

At audit time there was no `package/inky-runtime/` in `buildroot_os`: the image
had the engine patch (`package/renpy/0001-add-eink-push-callback.patch`) but none
of the code that the patch's callback is supposed to feed. The package now exists
and installs that code.

### 2. Two divergent implementations of the same pipeline — now unified

| Concern | `runtime` (canonical owner) | `buildroot_os` (what's shipped) |
|---|---|---|
| Frame consumer | `frame_processor.eink_receiver` (`inky-eink-receiver`) — decode PNG → dither → pack → SPI/socket | *none installed* (hook points at a missing `eink_receiver.py`) |
| Socket env vars | `EINKY_EINK_SOCKET`, `EINKY_BACKEND`, `EINKY_SOCKET_PATH` | `RENPY_EINK_SOCKET`, `RENPY_INPUT_SOCKET` |
| Input vocabulary | button names `up/down/left/right/a/b/start` (per `protocol.md`) | `enter/space/escape` keysym-style names in `input_hook.rpy` |
| Panel frame format | `"EINK" + u32 w + u32 h + packed 1-bit` | not reached (no consumer) |

The **in-engine PNG framing itself is compliant** — `eink_hook.rpy` sends
`u32 length (BE) + PNG`, which matches `protocol.md`'s `[protocol.engine_capture]`.
The drift is in env-var names, the input name table, and the missing receiver —
not the capture wire format.

### 3. Single-game boot vs. the launcher

The OS boots **straight into `the_question`**. The `launcher` repo (the Ren'Py
boot menu) is not built or installed. [ADR 0007](https://github.com/einky/meta/blob/main/adr/0007-buildroot-os.md)
lists this as an explicit open item: *"reconcile the single-game appliance boot
with the launcher + multi-game model."*

## Per-repo status

| Repo | Wired into the device? | Verdict |
|---|---|---|
| `buildroot_os` | — (it *is* the image) | Active. Boots to a Ren'Py game on `llvmpipe` under Xvfb, with the `inky-runtime` frame pipeline + input bridge. Pi target has hardware parity (SPI/GPIO), pending on-board validation. Launcher not yet built in. |
| `runtime` | **Yes** | Packaged as `inky-runtime` and consumed by `inky-session` (frame receiver + input bridge + SPI driver). The single owner of the on-device pipeline per ADR 0008. |
| `games` | Build-time assembly | `the_question` assembled from the `renpy` source + InkyOS deltas (`board/common/the_question-eink/`) as a test fixture. Repo not consumed; `games/launcher` is cruft to delete. |
| `launcher` | **No** | The intended boot UI; not built into the image yet. `launcher/bridge` is retired per ADR 0006/0008 in favour of `runtime`. |
| `meta/shared` | Source of truth | `hardware.toml` + `protocol.md` define the one contract. Consumers must generate from it; the OS hooks currently hand-roll a divergent subset. |

## Recommended next steps

Ordered by leverage. The first two close the gap the audit found; the rest build
on a corrected foundation.

### Phase A — make the contract real (highest leverage) — landed

Items 1–2 are done: `package/inky-runtime/` builds the wheel and installs
`inky-frame` / `inky-input` / `inky-eink-receiver`, `inky-session` wires the
receiver + input bridge, and the button-name table is generated from
`hardware.toml`. Item 3 is only partly done — a couple of hook comments still
cite the old dev-side filenames.

1. **Write `package/inky-runtime/`** in `buildroot_os` that builds the `runtime`
   wheel and installs its three console-scripts (`inky-frame`, `inky-input`,
   `inky-eink-receiver`). On the emulator, wire `inky-eink-receiver` to the
   socket backend so the engine's PNG frames are actually decoded and dithered.
2. **Unify the socket/env contract.** Pick one set of names (the `runtime`
   `EINKY_*` set or the OS `RENPY_*` set) and align `inky-session.sh`,
   `eink_hook.rpy`, `input_hook.rpy`, and the runtime so they agree. Generate
   the input name table from `meta/shared/hardware.toml` instead of hand-listing
   `enter/space/escape`.
3. **Delete or relocate the dead references.** Either commit the dev-side
   `eink_receiver.py` / `input_sender.py` the hooks mention, or repoint the hook
   comments at `runtime`'s `tools/preview.py` and the packaged receiver.

### Phase B — close the emulator loop

4. **Verifiable e-ink preview in QEMU.** With the receiver packaged, capture a
   dithered 1-bit frame from a running emulator image and assert it against a
   golden — turning "it boots" into "the pipeline works", end to end, with no
   hardware.
5. **Input injection test.** Drive `input_hook.rpy` from the packaged
   `inky-input` (TCP/socket backend) and confirm a scripted button sequence
   advances the game.

### Phase C — boot model

6. **Decide launcher vs. single-game** (ADR 0007 open item). If the launcher is
   in: build `launcher/launcher` into the image, point `inky-session.sh` at it,
   and have it start games from a data partition. If single-game ships first,
   record that decision in an ADR and defer the launcher.

### Phase D — hardware bring-up — landed in software, pending on-board validation

7. **`inky_defconfig` parity — done.** The Pi Zero 2 W config now carries the same
   stack as the emulator (Mesa `llvmpipe` + Xvfb + Python3 + Ren'Py +
   `inky-runtime`) plus the hardware backend: `board/inky/config.txt` (generated
   from the contract) enables SPI + button pull-ups; the C SPI driver drives
   DC/RST/BUSY over `libgpiod` (1.6.5, v1 API) and streams the panel over
   `/dev/spidev0.0`; `board/inky/overlay` selects `EINK_BACKEND=spi` /
   `INPUT_MODE=gpio`. `./build.sh pi` produces a bootable `sdcard.img` that boots
   straight into `the_question`. A post-image guard
   (`board/inky/sync-config-txt.sh`, run before the rpi genimage step) re-copies
   `config.txt` on every image build, so a regenerated contract can never ship
   stale (Buildroot won't rebuild `rpi-firmware` on a config-file change).
   **Remaining:** validate on a wired board — `glxinfo` → `llvmpipe`, a real panel
   refresh, and button input — and settle the driver's three bring-up flip-points
   (frame inversion `EINKY_INVERT_FRAME`, gpiochip index `$EINKY_GPIOCHIP`, BUSY
   polarity).

### Cross-cutting — documentation hygiene

8. The other docs and three READMEs describe the target as current. As each
   phase lands, flip the corresponding present-tense claim from "planned" to
   "done" here and in [Overview](./overview), so this page can eventually be
   retired. Fix the `runtime` README's mis-citation (it credits "ADR 0008:
   runtime as buildroot package" — 0008 is titled *Shared hardware contract*).
