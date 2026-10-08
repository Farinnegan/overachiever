---
name: Glob dependency safety
description: Security rationale for avoiding braces-based file discovery.
---

Do not restore a glob library that depends on `braces` without confirming its resolved version fixes GHSA-vfj7-8cjw-p6xm.

**Why:** On 2026-10-08, the latest `braces` release was still vulnerable, as were the latest `fast-glob` and `micromatch` dependency chains. Replacing the file-discovery library was necessary; upgrading those parents could not resolve the finding.

**How to apply:** For future file-discovery changes, check the live advisory and dependency graph. Preserve nested TSX discovery and underscore-prefixed file/directory exclusions when changing implementations.
