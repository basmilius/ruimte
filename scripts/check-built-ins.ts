import { Glob } from 'bun';
import { readFileSync } from 'node:fs';

/*
 * The core reaches a built-in only through the slots in `extensions/registry.ts`, so a built-in can be
 * turned off or moved without touching it. `apps/client/src/extensions/built-in.ts` is the one file that names one.
 */
const CLIENT = 'apps/client/src';
const BUILT_IN = /@extensions\//;
const offenders: string[] = [];

for (const found of new Glob('**/*.{ts,tsx}').scanSync(CLIENT)) {
    // Windows hands back backslashes.
    const path = found.replaceAll('\\', '/');

    // A test of a built-in draws it through the host, so it may name the built-in's own stores.
    if (path === 'extensions/built-in.ts' || /\.test\.tsx?$/.test(path)) {
        continue;
    }

    const imports = readFileSync(`${CLIENT}/${path}`, 'utf8').match(/from '[^']+'|import '[^']+'/g) ?? [];

    if (imports.some((line) => BUILT_IN.test(line))) {
        offenders.push(path);
    }
}

if (offenders.length > 0) {
    console.error(`The core imports a built-in in:\n${offenders.map((path) => `  ${CLIENT}/${path}`).join('\n')}`);
    process.exit(1);
}
