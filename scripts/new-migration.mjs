import { readdir, writeFile } from "node:fs/promises";
const name = process.argv[2];
if (!/^[a-z][a-z0-9_]{2,70}$/.test(name || ""))
  throw Error("Use npm run db:generate -- descriptive_name");
const folder = new URL("../db/migrations/", import.meta.url),
  files = (await readdir(folder)).filter((n) => /^\d{4}_.*\.sql$/.test(n)),
  number = String(
    Math.max(0, ...files.map((n) => Number(n.slice(0, 4)))) + 1,
  ).padStart(4, "0");
const path = new URL(number + "_" + name + ".sql", folder);
await writeFile(
  path,
  "-- Review PostgreSQL migration; preserve existing data.\n-- Applied transactionally by migrate-postgres.mjs after a verified checkpoint.\n",
  { flag: "wx" },
);
console.log("Created db/migrations/" + number + "_" + name + ".sql");
