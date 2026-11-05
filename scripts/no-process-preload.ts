import { afterEach } from 'bun:test';
import { createRequire } from 'node:module';

/*
 * The unit run starts no process, also not through production code a test calls, which
 * `check-test-clock.ts` cannot see from the test file's text. Only the unit configs load this
 * (`bunfig.toml`, `windows-ci.bunfig.toml`, `apps/client/bunfig.toml`); the DOM and integration
 * runs have configs of their own.
 *
 * A starter throws, and since code under test may catch that, the test also fails afterwards.
 */

const RULE = 'A unit test starts no process (root CLAUDE.md, Conventions). Give the code a fake runner, or move the test to an *.integration.test.ts.';

const NODE_STARTERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
const BUN_STARTERS = ['spawn', 'spawnSync', '$'] as const;

// The CommonJS exports, since an ESM import's named bindings follow them and not its default object.
const childProcess = createRequire(import.meta.url)('node:child_process') as Record<string, unknown>;

const attempts: string[] = [];

function refuse(what: string): () => never {
    return () => {
        // Where the code under test called it, since the test file's own text may not show it.
        const callers = (new Error().stack ?? '')
            .split('\n')
            .slice(2, 6)
            .map((line) => line.trim());

        attempts.push(`${what} ${callers.join(', ')}`);

        throw new Error(`${what} was called. ${RULE}`);
    };
}

for (const name of NODE_STARTERS) {
    Object.assign(childProcess, { [name]: refuse(`node:child_process ${name}`) });
}

for (const name of BUN_STARTERS) {
    Object.assign(Bun, { [name]: refuse(`Bun.${name}`) });
}

afterEach(() => {
    if (attempts.length === 0) {
        return;
    }

    const started = attempts.splice(0).join(', ');

    throw new Error(`This test started a process: ${started}. ${RULE}`);
});
