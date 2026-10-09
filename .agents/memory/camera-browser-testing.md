---
name: Camera browser testing
description: Headless graphics limits, synthetic camera pitfalls, and verification boundaries
---

The test browser may fail to initialize MediaPipe because WebGL contexts are unavailable, even though the same browser can record and play real MediaRecorder video.

**Why:** This happened when testing silent training clips with synthetic canvas input. It blocked camera startup before the otherwise-working recorder could be exercised.

**How to apply:** Distinguish inference failures in the test environment from recording/storage failures. If testing independent clip functionality with inference replaced, report that limitation explicitly; successful synthetic-video tests do not establish pose-recognition accuracy or iOS compatibility.

Validate the synthetic camera and detector inputs before treating a zero-count browser test as an app defect.

**Why:** Working reference classification appeared broken in a live-session test because the test detector returned the wrong result shape and a later test reused an already-stopped stream.

**How to apply:** Confirm that the actual detector instance supplies the expected landmarks, the video has valid dimensions, and its clock continues advancing. Test doubles must honor both input contracts and camera lifetimes. Report reference-pose counting separately from real-camera pose detection.
