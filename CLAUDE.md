# Overachiever

Personal camera rep counter (squats, front push-ups, side leg raises). Vite + React, no backend, deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `main`.

## Workout data

- The phone uploads one JSON file per workout to `data/sessions/` (via the GitHub API with a fine-grained token stored in the browser). Always `git pull` before analyzing.
- Each file is a `PoseLog` (`src/tracking/replay.ts`): `exercise`, `countedReps` (what the app counted live), `actualReps` (what Fal says she did), `placement` (where the phone was), `trackerVersion`, `aspect`, `joints` (MediaPipe landmark indices), and `frames` at 10 fps with `p = [x, y, visibility]` per joint in `joints` order. `missedFlags` are ms offsets where she tapped "Missed one".
- `data/training/` holds older samples from the first Replit version (4 fps, one rep each).
- Pushes that only touch `data/**` don't redeploy the site.

## Tuning counts

- All thresholds and per-exercise measurements: `src/tracking/exercises.ts`. Shared counting logic: `src/tracking/counter.ts`.
- `npm run replay` replays every uploaded session through the current trackers and compares with `actualReps`. Add a file path and `--trace` to see the tracked value and counter state over time.
- A change is an improvement only if replay gets more sessions exact without breaking others. Bump `TRACKER_VERSION` when counting behaviour changes.
- `npm test` must pass (synthetic reps plus the recorded Replit samples).

## Constraints

- Videos never leave the phone. Pose data (joint coordinates) is fine to upload.
- No model training: counting is rules on top of Google's MediaPipe pose model.
- Brand palette: white #FFFFFF, black #000000, lime #D4FF00, orange #FF6600.
