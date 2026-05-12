---
sidebar_position: 3
---

# Getting Started for Developers

einky lives across [ten sibling repositories](../architecture/overview#repo-layout). The `meta` repo is the **only** clone you start from — it provides `bootstrap.sh`, which fans out and clones everything else.

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

After it finishes, your tree should look like the [Repo layout](../architecture/overview#repo-layout).

## 3. Install the Ren'Py SDK

The SDK is **vanilla** — we do not fork or patch it. `meta/scripts/install_sdk.sh` downloads the latest upstream release, strips Windows/macOS payloads, and leaves a ready-to-run SDK directory.

```bash
cd ../meta
./scripts/install_sdk.sh
```

## 4. Bring up the local dev stack

```bash
docker compose -f compose/docker-compose.dev.yml up
```

This boots Postgres and mounts `../server` and `../web` as live-reloading volumes.

## 5. Run the runtime against the launcher

From the workspace root, with Xvfb available:

```bash
Xvfb :1 -screen 0 800x480x24 &
DISPLAY=:1 python3 -m runtime --output socket
```

The runtime starts the launcher (`../launcher`) as a Ren'Py game. Frames are emitted to a Unix socket — point the dev viewer at it to see the e-ink simulation without hardware.

## What goes where

| You're touching… | Repo |
|---|---|
| The boot menu UI | `launcher/` (Ren'Py script) |
| Frame pipeline, input mapping, SDK supervision | `runtime/` |
| API endpoints, catalog DB | `server/` |
| Admin / store UI | `web/` |
| OS image, systemd units | `os/` |
| Architecture decisions | `meta/adr/` |
