# xAutoML

Hard-coded app UI for the AutoML + xAI pipeline: detect → clean → train → explain.

## Stack

- React + TypeScript + Vite
- Hosted on [Netlify](https://www.netlify.com/) (static free tier)

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

## Deploy to Netlify (free)

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project**.
3. Connect the repo. Build settings are already in `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Deploy. Netlify will give you a `*.netlify.app` URL.

Or from the CLI:

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```
