import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { referenceModules } from '../src/lib/reference-source.ts';

/* Writes the reference the site draws. `reference.test.ts` fails while it differs from the types. */
const target = join(import.meta.dir, '../src/generated/reference.json');
const next = `${JSON.stringify(referenceModules(), null, 4)}\n`;
const before = (() => {
    try {
        return readFileSync(target, 'utf8');
    } catch {
        return '';
    }
})();

writeFileSync(target, next);
console.log(before === next ? 'The reference was up to date' : 'Wrote src/generated/reference.json');
