# HeroScape Draft

Live online snake drafts of HeroScape armies with friends, from the host's collection.
Supports Normal and Delta pricing. Hosted at **heroscape.botched.tech**.

## How it works

One Node 24 process (`server/`) serves everything:

- **The site**: the React app built by Vite (`dist/`).
- **The API** (`/api/...`): anonymous cookie sessions, drafts and lobbies, draft actions validated with the
  same rules code the browser uses (`src/lib/draft.ts`), photo uploads, Discord pings.
- **Live updates**: Server-Sent Events (`/api/drafts/:id/events`, `/api/photos/events`).
- **Storage**: SQLite (Node's built-in `node:sqlite`) and photo files, both in `DATA_DIR`.

The runtime needs no npm packages; Node runs the TypeScript server directly.

## Development

```
npm install
npm run dev:server   # API on :8787 (data in ./data)
npm run dev          # site on :5173, proxies /api and /photos to :8787
```

`npm test` runs the rules, synergy, backup-format and server tests.

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` (`8000` in Docker) | |
| `DATA_DIR` | `./data` (`/data` in Docker) | SQLite database + photos; must persist |
| `SITE_DIR` | `./dist` | built site |
| `PHOTO_CODE_HASH` | none (photo editing off) | SHA-256 hex of the photo code; set in `deploy/homelab/apps/heroscape/release.yaml` |

## Photo backups

The cluster has no backups. On **Unit photos** (after entering the photo code), use **Download backup**
to save every photo and thumbnail as a zip, and **Restore from backup** to load one.

## Unit data

`src/data/units.json` is a snapshot of the unit list from the [heroscape.org](https://heroscape.org/builder/)
army builder (Chris Perkins' Autoload Builder). Refresh with `npm run import-units` (also rebuilds synergies).

## Collections

`npm run import-collection -- <heroscapehelper-username>` reads a public HeroScape Helper collection page into
`src/data/collections/<username>.json`. Units HeroScape Helper doesn't list go in
`src/data/collection-extras/<username>.json`.

## Synergies

`npm run synergies` rebuilds `src/data/synergies.json` from power text; hand fixes go in
`src/data/synergy-overrides.json`.
