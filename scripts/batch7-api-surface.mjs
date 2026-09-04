#!/usr/bin/env node
// Batch 7 -- what of platform-web's API surface can actually reach a server.
//
// The Probe-Decide-Rebuild plan asks for "the thirty-method checklist in a form
// you can tick off while clicking". Transcribing that list by hand goes stale
// with the next commit, so this derives it from the source instead: every method
// on the API layer, classified by whether it has a live branch at all.
//
// platform-web keeps one seam between mock and live -- `isLiveApi` in
// src/api/http.ts. A method that tests it can reach platform-api; a method that
// does not is mock in every mode, including VITE_API_MODE=live. That single
// signal is what this reports, split three ways:
//
//   wired            -- has an isLiveApi branch, so a click can produce a request
//   silent-write     -- a mutation with no live branch: reports success, and the
//                       server never hears about it
//   fabricated-read  -- a read with no live branch: invented data rendered as real
//
// "wired" means reachable, not correct: the live path can still hand back mock
// values (live.getDashboardSummary spreads the mock summary over whatever the
// engine returned). Reachability is what a click-through can confirm; that is
// the question this answers.
//
// Usage:
//   node scripts/batch7-api-surface.mjs           # summary + the unwired lists
//   node scripts/batch7-api-surface.mjs --json    # machine-readable
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "platform-web", "src", "api");

// The API layer declares async methods in three shapes, and all three carry
// surface a click can reach, so all three have to be counted:
//   class method     async name(args): Promise<T> {
//   object property  name: async (args): Promise<T> => {
//   bare export      export const name = async (args): Promise<T> => {
const SIGNATURE =
  /^[ \t]*(?:async\s+([A-Za-z0-9_]+)\s*\(|([A-Za-z0-9_]+)\s*:\s*async\s*\(|export\s+const\s+([A-Za-z0-9_]+)\s*=\s*async\s*\()/gm;

/** Yield {name, body} for every async method in `source`, matching braces so nested ones do not split a body. */
function readMethods(source) {
  const found = [];
  SIGNATURE.lastIndex = 0;
  let match;
  while ((match = SIGNATURE.exec(source))) {
    const name = match[1] ?? match[2] ?? match[3];
    let index = SIGNATURE.lastIndex;
    for (let depth = 1; index < source.length && depth > 0; index += 1) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") depth -= 1;
    }
    // Skip the return type annotation before looking for the body. Several
    // methods here are typed `Promise<{ workflow: Workflow, ... }>`, and taking
    // the first `{` after the arguments would capture that object type as the
    // body -- which hides the `isLiveApi` branch and misreports a wired method
    // as silent. The body brace is the first one not nested inside `<...>`.
    for (let angle = 0; index < source.length; index += 1) {
      if (source[index] === "=" && source[index + 1] === ">") index += 1;
      else if (source[index] === "<") angle += 1;
      else if (source[index] === ">") angle -= 1;
      else if (source[index] === "{" && angle === 0) break;
    }
    const start = index;
    for (let depth = 0; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
    }
    found.push({ name, body: source.slice(start, index) });
  }
  return found;
}

// A mutation reports success to the user, so an unwired one is the dangerous
// half of the split -- it is the class the plan singles out as unsafe wherever
// it runs. Read verbs are listed rather than inferred from the return type,
// because plenty of mutations here return an object (createConnection,
// updateProfile) and `lockSessions`/`restrict`/`purchase` return one too.
const READ_VERBS = /^(get|list|fetch|read|search|query|find|for)[A-Z]?/;

function classify({ name, body }) {
  if (/isLiveApi/.test(body)) return "wired";
  return READ_VERBS.test(name) ? "fabricated-read" : "silent-write";
}

const rows = [];
for (const { name, body } of readMethods(readFileSync(join(apiDir, "client.ts"), "utf8"))) {
  rows.push({ module: "client.ts", name, kind: classify({ name, body }) });
}
for (const file of readdirSync(join(apiDir, "services")).sort()) {
  for (const { name, body } of readMethods(readFileSync(join(apiDir, "services", file), "utf8"))) {
    rows.push({ module: `services/${file}`, name, kind: classify({ name, body }) });
  }
}

const of = (kind) => rows.filter((row) => row.kind === kind);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const modules = [...new Set(rows.map((row) => row.module))];
const wired = of("wired").length;
console.log(`platform-web API surface: ${rows.length} methods across ${modules.length} modules`);
console.log(`  wired (a click can reach platform-api) : ${wired} (${Math.round((wired / rows.length) * 100)}%)`);
console.log(`  silent-write (reports success, no call): ${of("silent-write").length}`);
console.log(`  fabricated-read (invented data as real): ${of("fabricated-read").length}`);

console.log(`\nFULLY MOCK MODULES -- every surface backed by these is invented:`);
for (const module of modules) {
  const inModule = rows.filter((row) => row.module === module);
  const live = inModule.filter((row) => row.kind === "wired").length;
  if (live === 0) console.log(`  ${module.padEnd(30)} ${inModule.length} methods, none wired`);
}

console.log(`\nSILENT WRITES -- a click reports success and the server never hears:`);
for (const row of of("silent-write")) console.log(`  [ ] ${row.module.padEnd(30)} ${row.name}`);

console.log(`\nFABRICATED READS -- rendered as real data:`);
for (const row of of("fabricated-read")) console.log(`  [ ] ${row.module.padEnd(30)} ${row.name}`);
