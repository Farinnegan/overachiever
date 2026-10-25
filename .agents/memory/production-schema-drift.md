---
name: Production schema drift
description: Production database columns can lag the development schema during data exports.
---

**Rule:** Before exporting production records, inspect `information_schema.columns` and query only columns present in production. Do not assume the current development schema has already been deployed.

**Why:** The production training table was missing fields present in the development schema, so the first export query failed until it was adapted to the live columns.

**How to apply:** Check the production schema before one-off exports or diagnostics, and document any omitted fields in the resulting dataset.
