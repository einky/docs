---
sidebar_position: 2
---

# Server: Backend Research

The `server` repo provides the catalog API, telemetry intake, and management endpoints consumed by `web` and (read-only) by the on-device runtime.

## Decision: FastAPI

We evaluated four candidates. **FastAPI** is the chosen backend.

The rationale is captured as an Architecture Decision Record — see [ADR 0003 — FastAPI for the backend server](../architecture-decisions/0003-fastapi-server.md). The short version:

- **Python everywhere.** The runtime, the frame pipeline, and the SDK install scripts are already Python. Sharing a language across `runtime/` and `server/` lets us reuse Pydantic models for catalog entries and telemetry payloads on both sides of the wire, and lets contributors move between repos without context-switching.
- **Type-checked schemas + free OpenAPI.** Pydantic gives us validated request/response models; FastAPI emits an OpenAPI document directly from those types, which `web/` consumes for its TypeScript client.
- **Async, but not exotic.** ASGI is enough for our load profile (low-RPS catalog reads, batched telemetry writes). We don't need Go's concurrency model.

## Candidates considered

| Framework | Language | Why not |
|---|---|---|
| **FastAPI** | Python | **Chosen.** See above. |
| Gin | Go | Faster ceiling we will not hit; introduces a second language without a corresponding payoff. No ergonomic equivalent of Pydantic + auto-OpenAPI. |
| Laravel | PHP | Mature ecosystem, but adds a third language and a heavier runtime than the workload justifies. None of the team is currently shipping PHP. |
| Django | Python | Same language win as FastAPI, but the batteries (ORM, admin, templating) are weighted toward server-rendered apps. We render the admin UI in `web/`, so Django's strengths are mostly unused while its conventions get in the way of an API-first design. |

## What lives in `server/`

- **Catalog**: list/detail endpoints for games, cover art URLs, version metadata.
- **Telemetry**: ingestion endpoint for crash reports and battery/usage stats from the runtime.
- **Management**: authenticated endpoints used by `web/` for content publishing.

Postgres is the data store. The local dev compose stack (`meta/compose/docker-compose.dev.yml`) brings it up alongside `server` and `web`.
