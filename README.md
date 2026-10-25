# Overachiever

A personal accountability app that runs in the phone browser. It counts squats, front-facing push-ups and side leg raises with the camera, keeps your workout history, streak and weekly target, and has no server: everything stays on the phone.

Live: https://farinnegan.github.io/overachiever/

## How counting works

MediaPipe Pose Landmarker runs on the phone and gives 33 body points per frame. Each exercise turns those into one number:

| Exercise | Number tracked | Needs in frame |
|---|---|---|
| Squats | Knee angle (hip, knee, ankle) | Hips, knees, ankles |
| Push-ups | Shoulder-to-wrist height divided by shoulder width | Shoulders, arms, hands (front view) |
| Side leg raises | Angle at the pelvis between the two thighs | Hips and both knees |

You hold the starting position still for about half a second so it learns your personal starting value. A rep is moving far enough away from that value and coming back. All thresholds live in `src/tracking/exercises.ts`.

There is no model training. The pose model is Google's, and the counting is simple rules on top of it, tuned with your own recorded data.

## Improving the counts with your own data

1. After a workout, the app asks how many reps you actually did and keeps the session's joint positions (no video).
2. Settings → Export pose data gives you a JSON file.
3. Change a threshold in `src/tracking/exercises.ts`, then run `npm run replay -- path/to/export.json`.
4. Keep the change if more sessions match your actual count. Push to `main` and the site updates.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173 (camera works on localhost)
npm test           # tracker tests, including replays of real recorded reps
npm run build
```

Testing on your phone needs https, so the easiest way is to push and use the GitHub Pages site.

## Layout

- `src/tracking/` counting logic, no browser APIs, so it runs in tests and replays
- `src/session/` camera, pose model, overlay, workout screen, clip recorder
- `src/data/` workout history and settings (localStorage), pose logs (IndexedDB)
- `data/training/` pose samples exported from the first Replit version
- `.github/workflows/deploy.yml` runs tests and deploys to GitHub Pages on every push to `main`
