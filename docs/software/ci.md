---
sidebar_position: 6
---

# CI pipeline

CI exists to enforce one invariant: **no repo can merge a change that breaks the
emulator boot or diverges from the shared contract.** Because the stack is split
across sibling repos ([`meta`](https://github.com/einky/meta),
[`runtime`](https://github.com/einky/runtime),
[`launcher`](https://github.com/einky/launcher),
[`buildroot_os`](https://github.com/einky/buildroot_os)), that guarantee has to
be *cross-repo*: a launcher change is only really green once it has been baked
into an image and passed the [A1 acceptance test](./inkyos-build.md#automated-acceptance-test).

## Two tiers

| Tier | Runs on | Cost | What it protects |
|---|---|---|---|
| **Fast per-repo** | every push/PR | seconds–minutes | lint, unit tests, contract + version-pin parity |
| **Expensive image + A1** | every push/PR (skippable by label) | tens of minutes warm, hours cold | the real boot → game session → reboot on a built image |

### Fast per-repo jobs

| Repo | Job(s) |
|---|---|
| `runtime` | `make lint` + `make test` (Python), C compile-check, **contract parity** (`gen_from_contract.py --check` — committed constants must match `meta/shared/hardware.toml`), install-script parity |
| `launcher` | `make setup` + `make lint` + `make test` (checks out `runtime` as an editable sibling dependency) |
| `buildroot_os` | **contract parity** (`scripts/gen_hardware.py --check`) + **version-pin parity** (`scripts/check_pins.py`: `meta/versions.env` vs `package/renpy/renpy.mk`, the Buildroot submodule tag, and the Buildroot config's target-Python / host-Cython pins) |

The parity jobs check out `meta` (and, for the pin check, the Buildroot
submodule) side-by-side, matching the sibling layout the scripts resolve by
default.

### The expensive job — `image-e2e.yml` (reusable)

`buildroot_os/.github/workflows/image-e2e.yml` is a **reusable** workflow
(`workflow_call`) that every repo's CI invokes. It:

1. checks out the four repos side-by-side at the refs the caller passes;
2. frees disk, restores the `.dl`/`.ccache`/output caches;
3. builds `inky_qemu_defconfig` via `./build.sh qemu` (containerized `br.sh`);
4. runs `make e2e` — the [A1 test](./inkyos-build.md#automated-acceptance-test)
   — against the freshly built image;
5. uploads the A1 failure artifacts (frame PNGs + guest serial) on failure.

Because `br.sh` mounts the sibling `runtime`/`launcher` checkouts via
`OVERRIDE_SRCDIR`, **the built image contains the PR's code, not the pinned
tags.**

## The cross-repo checkout matrix

The trap: a `launcher` PR must build the image with *its* branch but the
**default** branches of the others — a same-named branch may not exist
elsewhere. So each caller passes an **explicit** matrix; it never assumes
branch names line up.

| Caller (PR in…) | `buildroot_os_ref` | `runtime_ref` | `launcher_ref` | `meta_ref` |
|---|---|---|---|---|
| `buildroot_os` | PR head | main | main | main |
| `runtime` | main | PR head | main | main |
| `launcher` | main | main | PR head | main |

Each caller sets only its own input; the rest fall back to the `main` defaults
declared in `image-e2e.yml`.

```yaml
# launcher/.github/workflows/ci.yml
image-e2e:
  uses: einky/buildroot_os/.github/workflows/image-e2e.yml@main
  with:
    launcher_ref: ${{ github.event.pull_request.head.sha || github.sha }}
  secrets: inherit
```

## Caching

The Mesa/LLVM build is **hours cold, minutes warm**, so caching is load-bearing:

- **`.dl/`** (Buildroot downloads) and **`.ccache/`** persist across runs.
- Keys are pinned to the **Buildroot submodule SHA** plus a manual **`cache_bust`**
  input — a corrupted entry can otherwise wedge every build; bump `cache_bust`
  to discard it, and a Buildroot bump starts clean automatically.
- The whole **output tree** is cached too, but only *advisorily*: the key
  includes the `inky_qemu_defconfig` hash, so a defconfig change misses the
  cache and forces a clean build (config-only changes don't otherwise rebuild a
  package).

## Runner requirements & QEMU timing

- **Docker** (`br.sh` is containerized) and **tens of GB of disk** — the job
  frees the runner's preinstalled toolchains first; move to a larger runner if
  the build outgrows the default.
- **`qemu-system-aarch64`** (from `qemu-system-arm`) + **Pillow** for the A1
  harness.
- CI runs QEMU under **TCG** (no KVM for aarch64-on-x86), so the guest is
  several times slower than a laptop. A1 scales every deadline with
  **`E2E_TIMEOUT_MULT`** (default `4` in CI) rather than hard-coding CI timeouts.

## Skipping, nightly, and secrets

- **Docs-only changes:** label the PR `docs-only` and the `image-e2e` job is
  skipped (the fast parity/lint jobs still run).
- **Nightly pinned build** (`nightly.yml`): once a day it builds with
  `use_overrides: false` (`INKY_NO_OVERRIDE=1`) — i.e. from the **pinned tags**
  in the Buildroot packages, not the working trees — to catch pin drift the PR
  jobs (which always override) can't see. This needs the pinned sources to be
  fetchable (public, or a credentialed token in the container).
- **Secrets:** the sibling repos may be private, so the reusable workflow takes
  an optional read-only **`SIBLING_CHECKOUT_TOKEN`** (passed via `secrets:
  inherit`) to clone them; it falls back to the job token for public/same-repo
  runs.

## Reproducing CI locally

```bash
# fast parity gate (from buildroot_os, meta checked out as a sibling)
python3 scripts/gen_hardware.py --check
python3 scripts/check_pins.py

# the full image + A1 (what image-e2e.yml runs)
./build.sh qemu
E2E_TIMEOUT_MULT=1 make e2e     # bump the mult on a slow/loaded host
```

## What a broken commit trips

| Break | Caught by |
|---|---|
| lint / type / unit-test regression in runtime or launcher | that repo's fast `lint-test` job |
| committed constants edited out of sync with `hardware.toml` | contract-parity (runtime **and** buildroot_os) |
| `meta/versions.env` bumped but a Buildroot mirror not | `check_pins.py` (buildroot_os) |
| a change that breaks boot / frame pipeline / input / session / reboot | `image-e2e` A1 (in whichever repo's PR introduced it) |
| a pinned runtime/launcher tag that no longer builds or passes A1 | the nightly pinned build |
