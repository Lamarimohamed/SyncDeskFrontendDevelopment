# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/app/App.tsx`
- `src/app/` - `App.tsx` (providers + `RouterProvider`), `router.tsx` (lazy routes, auth guard), `ThemeProvider`, `ErrorBoundary`
- `src/pages/` - route pages by area (public, onboarding, dashboard, products, categories, stock, sync, devices, settings, errors)
- `src/components/` - `ui/` design system, `layout/`, `navigation/`, `sync/`, `devices/`, `brand/`
- `src/services/` - `syncService`, `sync/SyncEngine` (simulated CRDT sync), `auth/AuthService` (local demo auth), `container.ts` singletons
- `src/repositories/` - `Repository` interface + `MockRepository`; `src/domain/` types and rules; `src/state/` persisted stores; `src/hooks/`
- `src/styles/` - tokens, typography, base (imported by `src/index.css`)
- `vitest.config.ts` - tests (`npm test`); setup in `src/test/setup.ts`
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.
