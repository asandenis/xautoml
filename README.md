# xAutoML

AutoML + xAI app: upload → detect → clean → AutoML → explain.

## Backend (free)

Uses **[Supabase](https://supabase.com)** free tier (works with Netlify):

- Auth (email/password + Google)
- Postgres for profiles + run history
- Storage for encrypted documents

Per-user free-tier caps (so many users fit in one project):

| Resource | Limit |
|---|---|
| Storage | 40 MB / user |
| Files | 25 |
| File size | 8 MB |
| Runs | 15 / day |
| Run history | 40 kept |

## Setup

1. Create a free Supabase project.
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql).
3. Enable Email auth (and optionally Google) under **Authentication → Providers**.
4. Copy project URL + anon key:

```bash
cp .env.example .env
```

5. For Google: add your site URL / Netlify domain under Auth → URL configuration.
6. On Netlify, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy (Netlify free)

Import the GitHub repo. Build command `npm run build`, publish `dist` (see `netlify.toml`). Add the two Supabase env vars.
