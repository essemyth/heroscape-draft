# HeroScape Draft

Live online snake drafts of HeroScape armies with friends, from the host's collection.
Supports Normal and Delta (Classic / VC) pricing.

## Development

```
npm install
npm run dev
```

## Unit data

`src/data/units.json` is a snapshot of the unit list from the [heroscape.org](https://heroscape.org/builder/)
army builder (Chris Perkins' Autoload Builder). Refresh it when Delta costs change:

```
npm run import-units
```
