---
name: Camera browser testing
description: Graphics limitations of headless camera tests versus independent recording/storage checks
---

The test browser may fail to initialize MediaPipe because WebGL contexts are unavailable, even though the same browser can record and play real MediaRecorder video.

**Why:** This happened when testing silent training clips with synthetic canvas input. It blocked camera startup before the otherwise-working recorder could be exercised.

**How to apply:** Distinguish inference failures in the test environment from recording/storage failures. If testing independent clip functionality with inference replaced, report that limitation explicitly; successful synthetic-video tests do not establish pose-recognition accuracy or iOS compatibility.
