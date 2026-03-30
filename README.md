# Minecraft Schematic Viewer

A browser-based 3D viewer for Minecraft schematic files, built with Next.js and ready for Vercel deployment.

## Features

- Upload and parse `.schem`, `.nbt`, and legacy `.schematic` files
- Explore builds in full 3D with orbit or fly controls
- Material list with block counts and stack totals
- Build stats: dimensions, volume, non-air blocks, fill ratio, unique materials
- Responsive layout for desktop and mobile

## Local Development

Run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Production check:

```bash
npm run lint
npm run build
```

## Deploy To Vercel

From this project directory:

```bash
vercel
```

Then push production:

```bash
vercel --prod
```

If you have not logged in yet, run:

```bash
vercel login
```
