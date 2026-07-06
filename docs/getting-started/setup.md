---
sidebar_position: 2
---

# Setup & Running

For a fresh clone of the full workspace, see [Developer onboarding](./developers) — it walks through `meta/bootstrap.sh`, the canonical entry point.

There are two everyday dev loops, neither of which needs hardware:

1. **The full device in QEMU** — build the InkyOS image and boot it with a live e-ink preview window.
2. **The launcher on your workstation** — run `inky-launcher` directly from the repo for fast UI iteration.

## 1. Build & run InkyOS (the device image)

The build is containerized; QEMU runs on the host. *Develop against the emulator, validate against hardware.*

```bash
cd buildroot_os
git submodule update --init --recursive   # Buildroot is a pinned submodule

# Emulator target — fast, reliable day-to-day dev
./build.sh qemu          # -> output-qemu/
./run-emulator.sh        # boot QEMU + open the e-ink preview & gamepad window
# (./run-qemu.sh boots headless: serial console only, log in as root)

# Hardware target — the actual shipping SD image
./build.sh pi            # -> output/images/sdcard.img
sudo dd if=output/images/sdcard.img of=/dev/sdX bs=4M conv=fsync   # check /dev/sdX!
```

InkyOS boots straight into the **launcher** via the `inky-session` service — no
shell or desktop in the boot path. In the preview window: **arrows/wasd** move,
**j** = A, **k** = B, **Enter** = Start, **h** = hold-Start (exit a game).
Details: [InkyOS build system](../software/inkyos-build).

## 2. Run the launcher on your workstation

The launcher is a plain Python app; with the `tcp` backends it needs no panel,
no GPIO, and no QEMU:

```bash
cd launcher
make setup        # venv + editable install of ../runtime and this repo
make run-host     # launcher: frame server on :5333, input server on :5334
# in two other shells:
make preview      # live Tk window of the 1-bit frames
make send-input   # keyboard → button names
```

`run-host` scans the sibling `../games` checkout. Launching a game from here
additionally needs Xvfb and a Ren'Py checkout (`EINKY_RENPY`); on the device
those are baked into the image. Details: [Launcher internals](../software/launcher).

## Runtime library tests (`runtime`)

The `runtime` repo is a library (dither/pack pipeline, keymap, C SPI driver)
consumed by the launcher and the image — you rarely run it standalone, but its
test suite and the SPI extension build work anywhere:

```bash
cd runtime
make setup        # venv + dev deps
make build-c      # compile the SPI driver C extension (host smoke build)
make test         # unit + integration + golden dither hashes
```

> Panel size, pins, and the button map come from
> [`meta/shared/hardware.toml`](https://github.com/einky/meta/blob/main/shared/hardware.toml) — never hard-code them. Regenerate consumers with `make gen` (runtime) / `scripts/gen_hardware.py` (buildroot_os) after changing the contract.
