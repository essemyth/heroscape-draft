# HeroScape Draft

Live online snake drafts of HeroScape armies with friends, from the host's collection.
Supports Normal and Delta pricing.

## How it works

- **Browser app** (React + Vite): lobby, pool browser, armies. Everyone signs in anonymously and picks a name.
- **Supabase**: Postgres tables `drafts`, `draft_players`, `draft_secrets` with row-level security, plus
  Realtime so every screen updates as picks happen.
- **`draft-action` edge function**: the only thing that can change a draft's state. It checks that the caller
  is the player whose turn it is and validates the pick with the same rules code the browser uses
  (`src/lib/draft.ts`), then pings Discord.

## Setup

1. Create a Supabase project. In **Authentication → Sign In / Providers**, turn on **Allow anonymous sign-ins**.
2. Copy `.env.example` to `.env.local` and fill in the project URL and anon/publishable key.
3. Deploy the database and function:

   ```
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npm run deploy:db
   npm run deploy:functions
   ```

4. `npm install` then `npm run dev`.

Re-run `npm run deploy:functions` after changing the draft rules or the unit/collection data.

## Unit data

`src/data/units.json` is a snapshot of the unit list from the [heroscape.org](https://heroscape.org/builder/)
army builder (Chris Perkins' Autoload Builder). Refresh it when Delta costs change:

```
npm run import-units
```

## Collections

`npm run import-collection -- <heroscapehelper-username>` reads a public HeroScape Helper collection page into
`src/data/collections/<username>.json`.

## Unit photos

Put photos in `src/assets/units/<unit-id>.jpg` (or png/webp); see the README there.
