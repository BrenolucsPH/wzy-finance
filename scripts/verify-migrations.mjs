import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { migrationDigest } from "./migration-digest.mjs";
const lf = "ALTER TABLE example ADD COLUMN title text;\n-- Preserve data.\n",
  crlf = lf.replaceAll("\n", "\r\n"),
  legacy = createHash("sha256").update(crlf).digest("hex");
assert.equal(migrationDigest(lf).checksum, migrationDigest(crlf).checksum);
assert.equal(migrationDigest(lf).accepts(legacy), true);
assert.equal(migrationDigest(crlf).accepts(legacy), true);
assert.equal(migrationDigest(lf + "SELECT 1;").accepts(legacy), false);
console.log(
  "PASS Migration checksums accept Windows/Linux line endings and reject actual SQL changes",
);
