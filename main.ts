// Faster drop-in for makefun-site 1.0.0: driver. Reads every case from
// MAKEFUN_INPUT_DIR (or /input), answers each alone with run() from solve.js,
// and writes MAKEFUN_OUTPUT_DIR (or /output)/answers.json, in case order.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its
// work runs under it, as the house baseline does. R7: --no-opt disables the
// optimizing compiler, so the fresh process never pays TurboFan compile time
// on the cold path; measured 0.559-0.593 s vs R6 0.720 s. --no-lazy was tried
// and gave no further gain, so it is not set.
setFlagsFromString('--no-incremental-marking --no-opt');

/** solve.js, imported by its URL and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
