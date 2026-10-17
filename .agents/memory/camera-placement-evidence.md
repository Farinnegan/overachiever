---
name: Camera placement evidence
description: User-reported floor-versus-body-height counting behavior and limits of the initial evidence
---

The user's first real test counted reps accurately with the phone on the floor but counted nothing with the phone at body level.

The user wants push-ups counted from a front-facing camera; only the face, shoulders, arms, and hands need to be visible. Do not direct them to a side view or require legs/full-body framing for push-ups.

**Why:** The user clarified that front-facing, upper-body-only detection is the intended use; side-view guidance conflicts with that requirement.

**How to apply:** Build and troubleshoot push-up tracking from visible face and arm landmarks. Keep side-profile/full-body requirements for other exercises only when those exercises need them.

**Why:** This is a user-reported camera-placement difference, not a conclusion established by saved missed-pose samples. Initial stored examples contained only counted squats, so they cannot establish the cause of the zero-count setup.

**How to apply:** Treat camera placement as a variable when investigating misses. Compare actual missed-pose examples against counted references; do not claim a height-related cause from successful samples alone or tune thresholds solely on them.

Clear movement in the tracked exercise joints does not establish that the app recognized a complete usable pose.

**Why:** Real push-up missed reports included clear, high-confidence arm movement while the app remained in its unknown state. Framing problems explained some reports, but not all of the observed failure.

**How to apply:** Separate insufficient tracking, an unmatched reference pose, and an unarmed counting cycle before proposing a fix. Do not blame camera placement alone or lower recognition thresholds without evidence of which condition failed.
