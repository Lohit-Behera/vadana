# App Showcase (Vite + React)

Single-page React app for showcasing your product, ready to deploy on GitHub Pages.

## Showcase content

Update these fields in `src/App.jsx`:

- App title (`Your App Name`)
- Short pitch/description
- Button links (`View Source`, `Contact`)

## Quick start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

You can deploy in two ways:

```bash
npm run deploy
```

Or push to `main` and let GitHub Actions deploy automatically using:

- `.github/workflows/deploy-app-showcase.yml`

In repository settings, set **Pages** -> **Build and deployment** -> **Source** to **GitHub Actions**.

## Customize your page

Edit:

- `src/App.jsx` for the page content
- `src/index.css` for Tailwind theme and global styles
