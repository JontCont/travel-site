---
name: project-reference
description: Use as the shared fact sheet for the travel-site project before changing any travel skill or code. Covers architecture, access roles, SQLite storage, Docker deployment, environment variables, map providers, and validation commands. Also use for 專案架構、環境變數、驗證指令、專案參考.
---

# Project reference

Shared facts for the travel-site app. Other travel skills link here instead of repeating these details. The code is the source of truth. If a fact below disagrees with `src/`, `route-api.mjs`, `server.mjs`, `Dockerfile`, or `docker-compose.yml`, fix this file in the same change.

## Index

- [architecture.md](./references/architecture.md): runtime layout, endpoints and roles, sessions, storage, deployment, environment variables, map providers.
- [validation.md](./references/validation.md): npm scripts, test-file map, and the minimum checks for each kind of change.

## Quick facts

- Stack: Vite, React, and TypeScript client in `src/`. Node server (`server.mjs` with `route-api.mjs`) using the built-in `node:sqlite` module.
- `server.mjs` refuses to start unless `dist/index.html` exists, so run `npm run build` first.
- The whole trip workspace is one JSON document stored in one SQLite row.
- Access uses Synology SSO (DSM roles `admin` and `viewer`) plus guest access codes (read-only, limited to the trips an admin picks). There are no shared admin or viewer codes.

## Secrets

Never write real access codes, AMap keys, NAS passcodes, or Immich keys into the repo, skills, or docs. Use placeholders. `.env.example` holds placeholders only.
