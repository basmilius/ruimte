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

/*
 * And a built-in reaches the core only through the public extension API, as an installed extension does, so it
 * keeps working when it is packed like one. A test may also use the test runner and the testing package. The same holds
 * for an extension that is packed on its own (`limits`) or linked by the dev launch until it can be (`devcontainers`).
 */
const BUILT_IN_SOURCES = ['extensions/pets', 'extensions/limits', 'extensions/theme-umbra', 'extensions/devcontainers'];
const PUBLIC = ['@ruimte/extension/client', '@ruimte/extension/ui', '@ruimte/extension/agents-ui', '@ruimte/extension/charts', '@ruimte/extension/server'];
const LIBRARIES = ['react', 'react-dom', 'react/jsx-runtime', 'clsx', 'zod', 'zustand', 'lucide-react'];
const IN_TESTS = ['bun:test', '@ruimte/extension/testing'];
/*
 * A package of this repository an extension may import, since `extension pack` bundles it into the extension as its own
 * code. Each holds only code that imports nothing but itself, which the loop after this one checks.
 */
const BUNDLED: Record<string, { name: string; folder: string }[]> = {
    'extensions/devcontainers': [{ name: '@ruimte/devcontainer', folder: 'packages/devcontainer/src' }]
};
const reaches: string[] = [];

for (const folder of BUILT_IN_SOURCES) {
    for (const found of new Glob('**/*.{ts,tsx}').scanSync(folder)) {
        const path = found.replaceAll('\\', '/');

        if (path.startsWith('node_modules/') || path.startsWith('dist/')) {
            continue;
        }

        const test = /\.test\.tsx?$/.test(path) || path.startsWith('test/');
        const specifiers = [...readFileSync(`${folder}/${path}`, 'utf8').matchAll(/(?:from|import) '([^']+)'/g)].map((match) => match[1] ?? '');
        const allowed = (specifier: string) =>
            specifier.startsWith('.') ||
            PUBLIC.includes(specifier) ||
            LIBRARIES.includes(specifier) ||
            (BUNDLED[folder] ?? []).some((bundled) => bundled.name === specifier) ||
            (test && IN_TESTS.includes(specifier));

        for (const specifier of specifiers.filter((each) => !allowed(each))) {
            reaches.push(`  ${folder}/${path}: ${specifier}`);
        }
    }
}

for (const { folder } of Object.values(BUNDLED).flat()) {
    for (const found of new Glob('**/*.ts').scanSync(folder)) {
        const path = found.replaceAll('\\', '/');

        if (/\.test\.ts$/.test(path)) {
            continue;
        }

        const specifiers = [...readFileSync(`${folder}/${path}`, 'utf8').matchAll(/(?:from|import) '([^']+)'/g)].map((match) => match[1] ?? '');

        for (const specifier of specifiers.filter((each) => !each.startsWith('.'))) {
            reaches.push(`  ${folder}/${path}: ${specifier}`);
        }
    }
}

if (reaches.length > 0) {
    console.error(`A built-in imports outside the public extension API in:\n${reaches.join('\n')}`);
    process.exit(1);
}
