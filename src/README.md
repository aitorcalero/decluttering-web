# Run it

```
npm install
npm run dev        # Vite dev server (http://localhost:5173), demo mode
npm run typecheck && npm run lint && npm test && npm run e2e
npm run build      # dist/ (git-ignored)
```

`npm run e2e` builds the app and starts `vite preview` on port 4173. Run `npx playwright install chromium` once.

Layout: `domain/` is pure TypeScript (stale rules, cooldown, formatters) with tests beside it. `app-root.ts` is the demo-mode shell. Demo data is `public/demo/mock-small.json`.
