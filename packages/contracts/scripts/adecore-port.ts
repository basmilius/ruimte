import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

/*
 * The ADE CORE packages the port fixtures call. They are loaded by path from the client's manifest, since this package
 * does not depend on them and its type check must not read them; each caller types only what it uses.
 */
const fromClient = createRequire(resolve(import.meta.dir, '../../../apps/client/package.json'));

export function adecore<T>(name: string): Promise<T> {
    return import(fromClient.resolve(name)) as Promise<T>;
}

/** The folder a package sits in, for a package whose entry is a bundle in a subfolder. */
export function adecoreEntry(name: string): string {
    return dirname(fromClient.resolve(name));
}

/** A small seeded generator, so a fixture is the same on every run. */
export function seeded(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/** A fixture file with one line per case, so a hundred cases stay readable in a diff. */
export function compactFixture(groups: Record<string, readonly unknown[]>): string {
    const body = Object.entries(groups).map(
        ([name, cases]) => `  ${JSON.stringify(name)}: [\n${cases.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n')}\n  ]`
    );

    return `{\n${body.join(',\n')}\n}\n`;
}
