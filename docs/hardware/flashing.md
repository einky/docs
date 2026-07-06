---
sidebar_position: 4
---

# Flashing InkyOS to an SD card

This guide covers writing the **InkyOS** device image (the `buildroot_os` hardware
target) to a MicroSD card and booting it on the Raspberry Pi Zero 2 W.

:::info Emulator vs. hardware
You only need to flash a card for the **hardware** target. For day-to-day development,
build and boot the **emulator** target instead (`./build.sh qemu` → `./run-qemu.sh`) —
no card required. See [Setup & Running](../getting-started/setup). *Develop against the
emulator, validate against hardware.*
:::

## What you are flashing

The hardware build produces a single, complete SD image at
`buildroot_os/output/images/sdcard.img` (~1.3 GB). It contains two partitions,
described by Buildroot's generated `genimage.cfg`:

| Partition | Type | Filesystem | Contents |
|-----------|------|------------|----------|
| `boot` | `0x0C` (FAT32, bootable) | vfat, 32 MB | Pi firmware (`bootcode.bin`, `start.elf`, `fixup.dat`), `config.txt`, `cmdline.txt`, the kernel `Image`, and `bcm2710-rpi-zero-2-w.dtb` |
| `rootfs` | `0x83` (Linux) | ext4, ~1.2 GB | The full InkyOS root filesystem — Ren'Py, Mesa/llvmpipe, Xvfb, the runtime pipeline, and the `inky-session` boot-to-game service |

You flash `sdcard.img` **whole** — it already carries both partitions and their
partition table. You do not format the card or copy files individually.

## Prerequisites

- A MicroSD card, **4 GB or larger**, and a card reader.
- The built image. If `buildroot_os/output/images/sdcard.img` does not exist yet,
  build it first (this runs in Docker and takes a while on the first run — Mesa/LLVM
  is the long pole):

  ```bash
  cd buildroot_os
  git submodule update --init --recursive   # Buildroot is a pinned submodule
  ./build.sh pi                             # HARDWARE target -> output/images/sdcard.img
  ```

## Step 1 — Identify the card

:::danger Get this right
`dd` writes to whatever device you name, with **no confirmation**. Naming your system
disk instead of the card will destroy it. Double-check the size and model.
:::

Plug in the card and list block devices:

```bash
lsblk -o NAME,SIZE,MODEL,TRAN,MOUNTPOINT
```

Find the entry whose size matches your card (e.g. a 16 GB card shows ~14.8 G) and note
its device node — `/dev/sdX` on most Linux hosts, or `/dev/mmcblkN` for a built-in
reader. That whole-disk node (**not** a partition like `/dev/sdX1`) is your target
below. If the card automounted, unmount its partitions first (`sudo umount /dev/sdX*`)
— but do **not** unplug it.

## Step 2 — Flash the image

### Option A — `dd` (Linux / macOS)

```bash
cd buildroot_os
sudo dd if=output/images/sdcard.img of=/dev/sdX bs=4M conv=fsync status=progress
sync
```

Replace `/dev/sdX` with the node from Step 1. `conv=fsync` forces the data to disk
before `dd` returns; the extra `sync` is belt-and-suspenders. On macOS use the *raw*
node `/dev/rdiskN` (faster) and `bs=4m`.

### Option B — Raspberry Pi Imager / balenaEtcher (any OS, GUI)

Prefer a GUI or on Windows? Use **[Raspberry Pi Imager](https://www.raspberrypi.com/software/)**
(or [balenaEtcher](https://etcher.balena.io/)):

1. Choose OS → **Use custom** → select `output/images/sdcard.img`.
2. Choose the SD card as the target.
3. Write. These tools verify the write and refuse system disks, so they are the
   safer choice if you are unsure.

Do **not** apply Raspberry Pi Imager's OS-customization settings (hostname, Wi-Fi,
SSH) — InkyOS is a fixed appliance and ignores them.

## Step 3 — First boot

1. Move the card to the Pi Zero 2 W and power it via the **USB-C** port.
2. InkyOS boots straight into Ren'Py through the `inky-session` service — there is
   **no login prompt, shell, or desktop** on the panel. A correct boot ends on the
   game's main menu, rendered to the e-ink display.

The Pi resizes nothing at first boot and holds no writable state outside the rootfs —
it comes up the same way every time.

### Watching the boot (serial console)

The panel shows only the game, so for bring-up and debugging use the **UART serial
console**. Wire a 3.3 V USB-TTL adapter to the Pi's UART pins and open it at
**115200 baud**:

```bash
# Linux, with the adapter on /dev/ttyUSB0
picocom -b 115200 /dev/ttyUSB0
# or: screen /dev/ttyUSB0 115200
```

| Adapter | Pi pin (physical) | Pi signal |
|---------|-------------------|-----------|
| GND | 6 | GND |
| RX  | 8 | TXD (BCM 14) |
| TX  | 10 | RXD (BCM 15) |

The console runs on the PL011 UART (`ttyAMA0`); `config.txt` sets `dtoverlay=miniuart-bt`
to keep that UART free for the console and move Bluetooth to the mini-UART. Log in as
`root` (no password).

## Re-flashing after a change

Any change to the image — a rebuilt package, a kernel option, or a **pin change**
(see [Wiring → Changing a pin](./wiring#changing-a-pin)) — means rebuild and re-flash:

```bash
cd buildroot_os
./build.sh pi                     # or a targeted rebuild, e.g. ./br.sh make renpy-rebuild
sudo dd if=output/images/sdcard.img of=/dev/sdX bs=4M conv=fsync status=progress
```

The boot `config.txt` is refreshed into the image on **every** image build (by
`board/inky/sync-config-txt.sh`), so a regenerated pin config can never ship stale —
but you must still re-flash for it to reach the card.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| No output at all, no serial | Check power (a data-only USB cable won't do), reseat the card, confirm the write finished (`sync`). |
| `dd: /dev/sdX: Permission denied` | Run with `sudo`; make sure nothing on the card is still mounted. |
| Wrote to a partition (`/dev/sdX1`) not the disk | Re-flash to the **whole-disk** node (`/dev/sdX`). Flashing a partition leaves the card unbootable. |
| Serial console silent, panel dark | Verify RX/TX are **crossed** (adapter RX ↔ Pi TX), 3.3 V logic, and 115200 baud. |
| Boots to a shell instead of the game | The `inky-session` service failed to start — check its log over serial (`cat /var/log/messages`, look for `S95inky-session`). |
| Panel stays blank but serial shows Ren'Py running | e-ink SPI/GPIO bring-up issue — verify wiring against [Wiring](./wiring); the C SPI driver's flip-points (frame inversion, gpiochip index, BUSY polarity) are the usual suspects. |
