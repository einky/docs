---
sidebar_position: 5
---

# E-ink playbook

The project's rules for driving the 800×480 1-bit GDEM0397T81P panel well:
when to full-refresh vs partial-refresh, how to keep ghosting under control,
how dithering interacts with refresh, and how to not damage the panel. Every
display-touching change must follow this page; the [agent briefs](../roadmap/agent-prompts.md)
reference it as required reading.

## Panel model (what we're driving)

| Property | Value / consequence |
|---|---|
| Technology | Monochrome electrophoretic (e-paper). Pixels are physical particles moved by voltage — **not** emissive, **not** instant. |
| Resolution / depth | 800×480, driven as 1-bit (48 000-byte packed frames). |
| Image persistence | The panel **holds its image with zero power**. Blanking it costs energy; leaving it alone is free. Exploit this everywhere (sleep, shutdown, idle). |
| Full refresh | ~1–2 s, visibly **flashes** black/white several times. Fully resets particles: clears all ghosting, restores contrast. |
| Partial refresh | ~300–500 ms, no flash, only drives changed pixels. **Leaves residue** ("ghosting") that accumulates over successive partials. |
| BUSY line | The controller asserts BUSY during any refresh. **Never** start a new transfer/refresh while BUSY; always poll with a timeout (a stuck BUSY must error out, not hang the launcher). |
| Temperature | Waveform timing is temperature-dependent (controller compensates via its sensor + OTP LUTs). Cold panels refresh slower and ghost more; this is physics, not a bug. |
| Panel health | Long-term damage vectors: leaving the controller **powered but idle** (DC bias) — always deep-sleep between refreshes/idle; refreshing **faster than the panel completes**; and running **custom LUTs** (we use the OTP/factory LUTs only). |

## The refresh decision table

The launcher owns every refresh decision (that is *why* it exists — ADR 0009).
The policy, in priority order:

| Situation | Decision | Why |
|---|---|---|
| Frame is **byte-identical** to the last one shown | **Skip entirely** (no SPI traffic, no refresh) | Free on e-ink; saves panel wear + power. Dedup by hashing the packed frame. |
| First frame after boot / wake-from-sleep / panel re-init | **Full** | Panel state is unknown or stale; establish a clean baseline. |
| Screen/layout change (navigate to a different screen, dialog open/close, game scene change) | **Full** | Large-area change under partial refresh smears and ghosts badly; the flash reads as an intentional "page turn". |
| Game start and game exit (library ↔ game handoff) | **Full** | Different content domains; clear the previous world completely. |
| > ~40 % of pixels changed vs the previous frame | **Full** (treat as a layout change) | Partial refresh of most of the panel looks worse than a flash and ghosts more. Threshold tunable; measure on real glass. |
| Ghost budget exhausted (N partials since last full; default `full_refresh_every = 30`, user-tunable) | **Full** | Bounds accumulated ghosting. Count *partials shown*, not frames received (skipped frames don't dirty the panel). |
| Cursor/focus move, small dialog text change, in-scene dialogue advance, keyboard typing | **Partial** | Small deltas are what partial refresh is for; a flash here would be hostile. |
| Rapid successive frames (game animating faster than the panel) | **Drop intermediates**, show the newest when BUSY clears | Never queue refreshes. The panel is the clock: one refresh at a time, latest frame wins. Target ≤ 2 FPS (`[refresh] target_fps`). |
| Before shutdown / entering sleep | Show final frame (full if content changes), then **deep-sleep the panel** | Leaves a clean retained image at zero power; protects the panel. |
| Long static display (device idle for hours on one image) | One full refresh, then deep sleep — **never** periodic partial "keep-alives" | Image retention risk; the panel doesn't need refreshing to keep showing an image. |

Additional invariants:

- **One refresh in flight, ever.** Serialize all panel access behind one owner
  (the launcher's backend); wait BUSY (with timeout) between operations.
- A **user-triggered "clear screen"** (Settings) forces a full refresh — the
  standard e-reader escape hatch for visible ghosting.
- The **first press after wake** is consumed by the wake itself (never acts on
  the UI).

## Dithering on e-ink: the stability problem

The pipeline dithers greyscale to 1-bit. The algorithm choice interacts with
partial refresh in a way that is easy to get wrong:

- **Floyd–Steinberg (current default)** diffuses error across neighbours —
  output at pixel *p* depends on pixels *before* p. Consequence: a **tiny
  input change (one dialogue line) reshuffles dither noise across the whole
  frame**, so the frame-diff is huge, "skip identical frame" never triggers,
  partial refreshes sparkle everywhere, and the ghost budget burns down fast.
  FS is the right choice for *photographic stills* (best perceived quality),
  wrong for *frequently-updated similar frames*.
- **Ordered/Bayer (or blue-noise mask) dithering** is position-deterministic:
  the same input pixel always maps through the same threshold. Small input
  changes produce small output diffs. Slightly worse still-image quality,
  massively better refresh behaviour.
- **Plain threshold (≥128)** is what the launcher's own UI uses (it renders
  pure black/white by construction) — no noise, perfect diffs. Also the best
  choice for **text**: anti-aliased glyph edges under FS turn into fuzz;
  under threshold they stay clean (pick fonts with sturdy strokes — see UI
  rules).

**Project rule:** content chooses the dither. Launcher UI = threshold (by
construction). Game frames default to **ordered/blue-noise**; FS only for
provably-static content (e.g. a cover image render). Expose the choice
per-game (`inky-manifest.toml` `dither = "ordered" | "fs" | "threshold"`) and
as a display setting. The golden-frame tests pin whichever algorithms ship.

## 1-bit UI design rules (launcher + game template)

- **No animation, no transitions, no fades** — every intermediate frame is a
  panel refresh. Ren'Py games in the template define all transitions as
  `None`/instant and avoid ATL loops; the launcher never animates.
- **Focus/selection = inversion** (black row, white text). It's unambiguous at
  1-bit and cheap as a partial refresh.
- **Instant feedback beats fidelity:** on a button press whose action is slow
  (game launch), show a static "Starting…" frame immediately (already done),
  don't try to animate progress.
- **Fonts:** no thin/light weights — anti-aliased hairlines disintegrate at
  1-bit. Use regular/medium+ weights at generous sizes; verify with rendered
  goldens, not by eye on an LCD.
- **No greys in UI chrome.** Dithered grey panels next to text create noise
  that partial refresh smears. UI is pure black/white; dithering is for game
  imagery only.
- Design every screen to be operated with **exactly seven buttons** (d-pad,
  A, B, Start) — no hover, no pointer, no text entry except the on-screen
  keyboard. Games must not use `renpy.input()` (template documents this).

## Rate, latency, and memory budget

- Target ≤ **2 FPS** to the panel. The pipeline must *drop*, never *queue*:
  queueing adds unbounded latency between the player's press and the visible
  result — the single worst UX failure on e-ink.
- End-to-end latency budget for a press: input event → game reacts →
  stable-frame PNG → decode+dither (~tens of ms at 800×480 with numpy) →
  partial refresh (~400 ms). The refresh dominates; keep everything else
  boring.
- The Pi Zero 2 W has **512 MB RAM, no disk swap**, shared by: kernel, Xvfb,
  Ren'Py + llvmpipe (the hog — software GL buffers + LLVM JIT), the launcher
  (Pillow/numpy), and the page cache. QEMU runs with `-m 512` **on purpose** —
  keep it there so OOM appears in emulation, not in the field. On first hardware
  bring-up the stock config OOM-killed Ren'Py; the image now ships three memory
  measures, in order of impact:
  1. **Image-cache cap** — Ren'Py's `config.image_cache_size_mb` defaults to
     **400 MB** (bigger than half the box's RAM). The e-ink game hook
     (`eink_hook.rpy`) caps it to **64 MB**; an 800×480 1-bit panel needs no
     more. This was the primary OOM driver.
  2. **`LP_NUM_THREADS=1`** (set in `inky-session.sh`) — llvmpipe's per-thread
     tile buffers are pure memory cost; at ~2 FPS the lost parallelism is
     invisible.
  3. **zram swap** — a 384 MB lz4-compressed RAM swap (`CONFIG_ZRAM=y` +
     `S06zram` init script) as a spike backstop, since there is no disk swap.
  Further knob if still tight: lower the game's render resolution from 1280×720
  to the panel-native 800×480 (`gui.init` in the game's `gui.rpy`).

## Failure symptoms → causes (triage table)

| Symptom | Likely cause | First check |
|---|---|---|
| Image is inverted (black↔white) | Packing convention vs panel foreground (`packed_white_is_one` — driver must invert) | `EINKY_INVERT_FRAME` flip-point |
| Image mirrored / flipped / diagonal garbage | RAM scan direction / byte order / width mismatch | driver init sequence vs datasheet (E2 harness) |
| Panel never updates, process hangs | BUSY never released (wrong polarity, bad init, panel not reset) | BUSY polarity flip-point; RST timing; timeout must exist |
| Faint duplicate of previous screen | Normal partial-refresh ghosting | ghost budget too high; force full refresh |
| Whole screen "sparkles" on small changes | FS dither instability (see above) | switch content to ordered/threshold |
| Contrast slowly fading over a session | Too many partials, no fulls | refresh policy counters |
| Refreshes get slow/blotchy in a cold room | Temperature physics | expected; document, don't chase |
| Panel fine after boot, dead after idle period | Re-init after deep sleep missing on wake | wake path must `init()` + full refresh |
| Random SD corruption / boot loops on battery | Undervoltage / power cut during write | B1 read-only root; check supply before blaming software |
| "Newest save" resolves wrongly | No RTC — mtimes are meaningless before NTP sync | sequence numbers, not timestamps (B4) |

## Open questions to settle at driver desk-check / bring-up

Tracked for [E2/F](../roadmap/roadmap.md): whether the controller supports
**windowed partial update** (update only a bounding rectangle — faster SPI +
less disturbance; if yes, the refresh engine can exploit region diffs), the
exact partial-refresh LUT behaviour of this panel batch, measured full/partial
timings on real glass, and real ghosting accumulation vs our `30` default.
