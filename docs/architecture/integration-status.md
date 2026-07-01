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
:::

## TL;DR

| Question | Answer |
|---|---|
| Is **`runtime`** used by the OS today? | **No.** `buildroot_os` does not package or install it. The OS ships only the *producer* half of the e-ink path (the in-engine PNG capture hook); the *consumer* half (dither → 1-bit → SPI, GPIO input, C driver) lives only in `runtime` and is not integrated. |
| Is **`runtime`** useful to the project? | **Yes — eventually essential, currently orphaned.** It is the only implementation of the real e-ink frame pipeline, the GPIO handler, the C SPI driver for the GDEM0397T81P panel, and the ESP32 firmware. Not needed for the *emulator*; **cannot ship hardware without it.** |
| Is the **`games`** repo used by the OS? | **Not as a repo.** The OS embeds its own *vendored copy* of `the_question` under `board/qemu/overlay/opt/`. It is not pulled from `games/`. |
| Is **`games`** useful as-is? | **Low.** `the_question` is the upstream Ren'Py tutorial — a test fixture, not an einky title. `games/launcher/` is a misfiled Ren'Py SDK project browser that [ADR 0008](https://github.com/einky/meta/blob/main/adr/0008-shared-hardware-contract.md) says to delete. |

## What actually boots today (emulator path)

`inky_qemu_defconfig` produces an image that:

1. Boots BusyBox init → `S95inky-session` → `inky-session.sh`.
2. Brings up **Xvfb** (`:0`, `-fbdir /run` so the framebuffer is an XWD file).
3. Supervises **Ren'Py** (built from source, `/opt/renpy`) running the vendored
   **`the_question`** at `/opt/the_question`, restarting it on exit.
4. The engine renders into Xvfb on Mesa `llvmpipe` software desktop GL.

That much is real and verifiable. What is **not** happening end-to-end:

- **No frame consumer.** `eink_hook.rpy` pushes one PNG per stable frame to
  `/tmp/renpy-eink.sock`, but nothing in the image listens on that socket. The
  hook's own comment points at `eink_receiver.py` "at the repo root" — that file
  does not exist in `buildroot_os`. The dither/pack/SPI receiver only exists in
  `runtime` and is not installed.
- **No input source.** `input_hook.rpy` *binds* `/tmp/renpy-input.sock` and waits
  for commands, but no committed sender connects to it (the GPIO reader is in
  `runtime`; the dev `input_sender.py` it references is also absent here).
- So the appliance currently **renders a game into a virtual framebuffer and
  stops there.** No pixels reach an e-ink panel; no buttons reach the engine.

## The integration gap (root cause)

[ADR 0008](https://github.com/einky/meta/blob/main/adr/0008-shared-hardware-contract.md)
already diagnosed this: shared logic was implemented several times and drifted.
The decision was "**one owner**: the frame pipeline + SPI driver + keymap live in
`runtime`; `buildroot_os` consumes it as the `inky-runtime` Buildroot package."
**That package was never written.** As a result:

### 1. `runtime` is not packaged into the OS

There is no `package/inky-runtime/` in `buildroot_os`. The image has the engine
patch (`package/renpy/0001-add-eink-push-callback.patch`) but none of the code
that the patch's callback is supposed to feed.

### 2. Two divergent implementations of the same pipeline

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
| `buildroot_os` | — (it *is* the image) | Active. Boots to a Ren'Py game on `llvmpipe` under Xvfb. Missing the runtime consumer + launcher. |
| `runtime` | **No** | Real and valuable, but orphaned. Must become the `inky-runtime` package to have on-device effect. Until then it only serves dev preview / hardware bring-up out of band. |
| `games` | Vendored copy only | `the_question` embedded in the OS overlay as a test fixture. Repo not consumed; `games/launcher` is cruft to delete. |
| `launcher` | **No** | The intended boot UI; not built into the image yet. `launcher/bridge` is retired per ADR 0006/0008 in favour of `runtime`. |
| `meta/shared` | Source of truth | `hardware.toml` + `protocol.md` define the one contract. Consumers must generate from it; the OS hooks currently hand-roll a divergent subset. |

## Recommended next steps

Ordered by leverage. The first two close the gap the audit found; the rest build
on a corrected foundation.

### Phase A — make the contract real (highest leverage)

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

### Phase D — hardware bring-up

7. **`inky_defconfig` parity.** Bring the Pi Zero 2 W config to feature parity
   with the emulator (the same `inky-runtime` package, GPIO via `libgpiod`, the
   real SPI driver), then validate `glxinfo` → `llvmpipe` and a real panel
   refresh on the board.

### Cross-cutting — documentation hygiene

8. The other docs and three READMEs describe the target as current. As each
   phase lands, flip the corresponding present-tense claim from "planned" to
   "done" here and in [Overview](./overview), so this page can eventually be
   retired. Fix the `runtime` README's mis-citation (it credits "ADR 0008:
   runtime as buildroot package" — 0008 is titled *Shared hardware contract*).
