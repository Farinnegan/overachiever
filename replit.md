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
- The user changed their mind and wants correct/incorrect tagging for counted reps restored, alongside missed-rep reporting. Labels concern counting accuracy, not exercise form.
- The wrong-count tag from the user's initial test was accidental and remains excluded from analysis/training; this exclusion does not apply to later deliberately labeled incorrect counts. Do not delete the accidental sample without permission.
- Export/delete ownership uses a random browser key whose hash is stored server-side; clearing browser storage loses access to previously shared samples. Never put this key in URLs or logs.
- Pose inference stays on-device. Camera video stays local by default; the user explicitly requested a separate optional video-training mode for this personal app.
- Video training is a separate, default-off switch. Record only manually started, silent clips up to 15 seconds/20MB; preview and explicitly upload each clip. Store bytes privately in App Storage, only paths/metadata in Postgres.
- Replit Auth is required only for uploading/accessing clips, not workouts or local previews. Video ownership is account-based; pose contributions retain their existing anonymous browser-key ownership.
- Video clips include camera placement and expected versus counted reps for investigating misses. Neither pose labels nor video uploads trigger automatic retraining.
- Active exercises are squats and push-ups; the user explicitly replaced bicep curls. Keep past bicep-curl workout/training records readable, but do not offer it for new sessions or accept new curl uploads.
- Counting uses a browser adaptation of Google's MediaPipe/ML Kit nearest-neighbor pose classifier, original 812-example fitness reference CSV, exponential smoothing, and up/down confidence hysteresis. Require up→down→up completion and reset on tracking loss. This is reference-based classification, not automatic personal-data retraining.
- Preserve Google Apache-2.0 attribution and the unmodified reference CSV. Classifier inference uses full landmarks locally; pose contributions still store only the six exercise joints and no face coordinates.
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
