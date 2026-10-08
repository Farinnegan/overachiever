---
name: Generated API naming
description: Avoiding Orval component and operation-response export collisions
---

Avoid naming an OpenAPI response component exactly `<PascalCaseOperationId>Response`.

**Why:** Orval exports both component interfaces and operation-derived Zod response schemas through the same package. Identical names cause an ambiguous barrel export, despite successful code generation.

**How to apply:** Give reusable response components domain names such as a receipt or result. Fix naming in the OpenAPI source and regenerate; never patch generated files.
