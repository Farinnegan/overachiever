# Training and pose data export

Exported from the Replit production database on 2026-10-25 after the repository owner approved publishing training and pose data in this public GitHub repository.

- `rep_training_examples.json` contains 17 consented pose-training examples, phase labels, joint coordinates, and count-feedback labels.
- `training_video_metadata.json` contains metadata for one ready training clip. The raw video file is excluded from Git and was delivered separately to the owner.
- Account profiles, authentication sessions, owner IDs, contributor hashes, storage object paths, and session IDs are excluded.

Pose coordinates and repetition-feedback data are movement data and are public in this repository.

## Using it now

These samples were recorded with the old Replit app (4 frames per second, cut to a single rep). `npm run replay` runs them through the current trackers, and `tests/recorded-data.test.ts` checks them on every push. New sessions are recorded by the app itself and exported from Settings.
