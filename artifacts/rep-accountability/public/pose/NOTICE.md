# Google exercise reference data and browser adaptation

The unmodified fitness_pose_samples.csv is from Google ML Kit's vision quickstart:
https://github.com/googlesamples/mlkit/blob/master/android/vision-quickstart/app/src/main/assets/pose/fitness_pose_samples.csv

Classifier and embedding implementation adapted from Google's Apache-2.0 code:
https://github.com/googlesamples/mlkit/tree/master/android/vision-quickstart/app/src/main/java/com/google/mlkit/vision/demo/java/posedetector/classification

Copyright 2020 Google LLC. Licensed under the Apache License, Version 2.0.
See LICENSE. The original sample contains 812 labeled poses in four classes.

Changes: ported from Android Java to TypeScript; scaled MediaPipe normalized coordinates to reference image geometry; converted 0–10 votes to 0–1 scores; retained mirror-aware two-stage nearest-neighbor matching and 10-frame exponential smoothing; added visibility and discontinuity guards and an up→down→up completion requirement. The smoothing gap reset is 500ms for browser timing, instead of the Android sample's 100ms.

These are Google's existing reference examples, not newly trained personal data.
No user camera footage is sent to Google by this classifier.
