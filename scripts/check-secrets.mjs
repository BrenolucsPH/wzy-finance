import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
if (!files.length) throw Error("No tracked files to inspect; stage the public snapshot first.");
const rules = [
  ["GitHub credential", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ["Cloud access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Live service key", /\b(?:sk_live_|rk_live_|sk-proj-)[A-Za-z0-9_-]{20,}/],
  ["Private key material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Database URL with credentials", /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:(?!\$\{)[^\s@]+@/],
  ["Blob credential", /\bvercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9]{20,}\b/],
  ["Deployment credential", /\b(?:vcp_|vc_)[A-Za-z0-9]{30,}\b/],
  ["Private infrastructure identifier", /\b(?:prj_|team_|dpl_)[A-Za-z0-9]{15,}\b/],
];
const errors = [];
for (const file of files) {
  if (/(?:^|\/)(?:\.env(?:\..+)?|\.dev\.vars.*)$/.test(file) && file !== ".env.example") errors.push([file, "Private environment file"]);
  if (/^(?:\.vercel|\.qa-data|test-results|playwright-report|backups|uploads|data)(?:\/|$)/.test(file)) errors.push([file, "Private/generated directory"]);
  if (/\.(?:sqlite3?|db|dump|pem|key|p12|pfx|log|har|zip)$/i.test(file)) errors.push([file, "Private/binary operational artifact"]);
  if (/\.(?:png|jpe?g|webp|ico|woff2?)$/i.test(file)) continue;
  const body = readFileSync(file, "utf8");
  for (const [name, expression] of rules) if (expression.test(body)) errors.push([file, name]);
}
if (errors.length) {
  for (const [file, name] of errors) console.error(`${file}: ${name}`);
  throw Error("Publication check failed. Matched values are intentionally not printed.");
}
console.log(`PASS publication checks: ${files.length} tracked files inspected; no configured credential patterns or private artifacts found.`);
