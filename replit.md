# Rep Accountability

A phone-browser app that counts exercise repetitions using on-device camera pose recognition and tracks workout consistency.

## Run & Operate

- `pnpm --filter @workspace/rep-accountability run dev` — frontend, through its managed artifact workflow
- `pnpm --filter @workspace/rep-accountability run typecheck` — frontend typecheck
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- The first version is browser-only with local workout storage, not account-based or cross-device.
- This is a personal, single-user app. Training-data contribution is optional and off by default; enabled users explicitly label each sample before upload.
- Contributed samples store only six exercise-specific joints, visibility, movement phases, aspect ratio and count feedback. They are a dataset for future tracker improvement, not automatic retraining.
- Feedback should focus on missed counts, not judging whether counted reps were wrong. Ignore legacy `source=counted,label=incorrect` examples for analysis/training: the user said that label was clicked by mistake. Do not delete it without permission.
- Export/delete ownership uses a random browser key whose hash is stored server-side; clearing browser storage loses access to previously shared samples. Never put this key in URLs or logs.
- Camera video and pose inference stay on-device. Never add camera uploads without explicit user consent.
- Camera access requires a secure browser context. MediaPipe model and WASM assets require internet access when loading.
- Use the user's supplied palette throughout: white `#FFFFFF`, black `#000000`, lime `#D4FF00`, and pumpkin orange `#FF6600`.

## Product

- Camera-counted squats and bicep curls, session history, daily streaks, and a weekly workout target.

## User preferences

- The user wants the app openable from their phone's browser, rather than requiring a native app.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
