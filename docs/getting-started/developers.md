---
sidebar_position: 3
---

# Getting Started for Developers

einky lives across [sibling repositories](../architecture/overview#repo-layout). The `meta` repo is the **only** clone you start from — it provides `bootstrap.sh`, which fans out and clones everything else.

## 1. Clone `meta`

```bash
git clone https://github.com/einky/meta.git
cd meta
```

## 2. Run `bootstrap.sh`

`meta/bootstrap.sh` is the canonical entry point for the workspace. It clones every sibling repo into the parent directory, is idempotent (already-cloned repos are skipped), and prints a summary of what was cloned, skipped, or failed.

```bash
./bootstrap.sh           # clones over HTTPS (default)
./bootstrap.sh --ssh     # use SSH remotes instead
```

`buildroot_os` vendors Buildroot as a submodule, so after the clone:

```bash
git -C ../buildroot_os submodule update --init --recursive
```

After it finishes, your tree should look like the [Repo layout](../architecture/overview#repo-layout).

## 3. Install the Ren'Py SDK (workstation)

Developer machines run the **vanilla** upstream SDK. The installer pins the version and verifies its SHA256 (both from `meta/versions.env`):

```bash
cd ../meta
./scripts/install-renpy-sdk.sh ~/renpy
```

> The device itself does **not** use this tarball — InkyOS builds the same Ren'Py version from source (see [Architecture → Engine model](../architecture/overview#engine-model)).

## 4. Bring up the local dev stack (server/web)

```bash
docker compose -f compose/docker-compose.dev.yml up
```

This boots Postgres and mounts `../server` and `../web` as live-reloading volumes.

## 5. Run the device stack

Build and boot **InkyOS** in the emulator, and/or run the **`runtime`** pipeline against a Ren'Py game — see [Setup & Running](./setup).

## What goes where

| You're touching… | Repo |
|---|---|
| The boot menu UI | `launcher/` (Ren'Py script) |
| Frame pipeline, input/keymap, SPI driver, ESP32 bridge | `runtime/` |
| The device OS image, boot session, packaging | `buildroot_os/` |
| Pinout, keymap, wire protocols (shared) | `meta/shared/` |
| API endpoints, catalog DB | `server/` |
| Admin / store UI | `web/` |
