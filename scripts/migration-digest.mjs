import { createHash } from "node:crypto";
const hash = (text) => createHash("sha256").update(text).digest("hex");
export function migrationDigest(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  return {
    source: normalized,
    checksum: hash(normalized),
    accepts: (previous) =>
      [
        hash(source),
        hash(normalized),
        hash(normalized.replace(/\n/g, "\r\n")),
      ].includes(previous),
  };
}
