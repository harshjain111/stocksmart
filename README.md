# Smokzy Inventory System

Multi-branch inventory system for Smokzy — see [`PRD.md`](./PRD.md) for product spec and [`CLAUDE.md`](./CLAUDE.md) for build rules. Build sequence in [`BUILD_PROMPTS_1.md`](./BUILD_PROMPTS_1.md).

## Stack

Next.js 15 (App Router) · TypeScript (strict) · Supabase (Postgres, Auth, Storage, RLS) · Tailwind · shadcn/ui · Zod · react-hook-form · TanStack Query

## Getting started

```bash
cp .env.example .env.local   # fill in your Supabase project keys
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` — dev server (Turbopack)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run format` — Prettier write
