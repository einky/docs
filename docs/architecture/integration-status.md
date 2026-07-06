---
sidebar_position: 2
---

# Integration status

:::info Status ledger
This page records what is **actually wired and verified** versus what is still
pending, so the gap between design and reality stays visible and ownable. It is
produced from direct audits of the repos on disk, not from the other docs.

**Refreshed 2026-07-07** after the ADR 0009 launcher landed. The earlier audit
(2026-07-04) found `runtime` unconsumed and two divergent pipeline
implementations; both findings were fixed by `package/inky-runtime/` and are
now history. For what to do next, see the [Roadmap](../roadmap/roadmap.md).
:::

## TL;DR

| Question | Answer |
|---|---|
| Does the OS boot into the real product UI? | **Yes (emulator-verified).** `S95inky-session` supervises `inky-launcher` (ADR 0009): game library + settings, rendered natively, owning the display/input backends. |
| Is `runtime` consumed? | **Yes.** Built as the `inky-runtime` package; the launcher imports its dither/pack pipeline, keymap, and (on Pi) the C SPI driver. The single owner per ADR 0008. |
| Can a game be played end-to-end? | **Yes, on the emulator.** The launcher spawns the bundled `the_question` under Xvfb/llvmpipe; frames flow game → PNG socket → dither → TCP preview; input flows preview → launcher → input socket → game; exit (including hold-Start) returns to the library. |
| Does it work on real hardware? | **Unknown — the main open risk.** The Pi image (`inky_defconfig`) carries the full stack + SPI/GPIO backends and builds a bootable `sdcard.img`, but no physical board has validated it (launcher milestone M5). |
| Is the `games` repo used? | **Not as a repo.** The image assembles `the_question` at build time (stock game + InkyOS hooks) as a test fixture. Real einky titles and a sideload path don't exist yet. |

## Verified today (QEMU emulator)

1. Clean boot → BusyBox init → `inky-session` → **launcher UI** with no manual
   steps (`./run-emulator.sh` shows it live).
2. Library screen scans `/opt/games`, shows manifest metadata + covers.
3. Game launch: Xvfb on demand → Ren'Py boots on Mesa `llvmpipe` (desktop GL
   4.6) → `eink_hook.rpy` streams PNG frames → launcher dithers via the runtime
   pipeline → preview; buttons drive the game via `input_hook.rpy`.
4. Game exit and **hold-Start force-exit** both return to the library; a
   crash-on-startup surfaces an error screen.
5. Settings: display refresh cadence + persistence across a UI-triggered
   reboot; Wi-Fi join flow on the mock backend; power halt/reboot.
6. Host-side test suites: launcher unit + integration (fake game, golden
   frames, pack parity with runtime), runtime unit/integration/golden dither
   hashes, contract parity checks in both repos.

## Pending / unvalidated

| Area | State |
|---|---|
| **Hardware bring-up (M5)** | SPI panel driver, GPIO buttons, real Wi-Fi, boot-time behaviour on the physical Pi Zero 2 W — code-complete, never run on a board. Known flip-points: frame inversion, gpiochip index, BUSY polarity, `rpigpio` pin-factory behaviour. |
| **Games** | Only the tutorial fixture. No original title, no packaging convention beyond `inky-manifest.toml`, no sideload/update story (`games` repo effectively unused; `games/launcher` is pre-ADR-0009 cruft to delete). |
| **Rootfs hardening** | Root is read-write ext4; `/var/lib/inky` (settings/saves) is not a separate partition, so save survival across reflashes and power-cut robustness are unaddressed (buildroot_os "Phase 5"). |
| **First-boot UX** | No splash during the ~seconds of kernel boot; no SD-card "flash → greeting" polish pass. |
| **Server/web** | Design-stage only ([Server research](./server-research)); nothing on-device consumes them. |
| **CI** | Repo test suites exist; a cross-repo pipeline that builds the image and runs an emulator smoke test is not set up. |

## Historical note (closed gaps)

The 2026-07-04 audit found: (1) `runtime` not packaged into the OS, (2) two
divergent implementations of the frame pipeline with mismatched env-var and
input vocabularies, and (3) a single-game boot with no launcher. All three are
closed: `package/inky-runtime` + `package/inky-launcher` exist and are
consumed, the socket/env contract is unified on `RENPY_*` (engine-capture) +
`EINKY_*` (launcher backends) exactly as `meta/shared/protocol.md` specifies,
and the boot path is launcher-first per ADR 0009. The GPIO→xdotool→Xvfb input
chain and the ESP32 bridge were retired rather than fixed.
