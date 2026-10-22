import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const expected = 'd1667d432fbe36fb2b203b67c4a1b71cdfa9bee81315a317bf9823eaa3b8d8ff';
const content = gunzipSync(readFileSync(resolve(here, 'memoly-owner-dashboard-demo.html.gz')));
const actual = createHash('sha256').update(content).digest('hex');
if (actual !== expected) throw new Error(`Reference checksum mismatch: ${actual}`);
const output = resolve(repository, '.scratch/memoly-control-reference');
mkdirSync(output, { recursive: true });
const target = resolve(output, 'memoly-owner-dashboard-demo.html');
writeFileSync(target, content);
console.log(`Reference restored: ${target}\nSHA-256: ${actual}`);
