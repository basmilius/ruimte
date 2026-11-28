import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmOrigin, type OriginFetch } from './linux-origin';
import type { ProgramRun } from './program-run';

const VERSION = '0.40.0';
const PACKAGE = new TextEncoder().encode('the package');
const INTEGRITY = `sha512-${createHash('sha512').update(PACKAGE).digest('base64')}`;
const TARBALL = `https://registry.npmjs.org/@ruimte/linux-arm64/-/linux-arm64-${VERSION}.tgz`;

let root: string;
let asked: string[];
let unpacked: ProgramRun[];
let served: Uint8Array<ArrayBuffer>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-linux-origin-'));
    asked = [];
    unpacked = [];
    served = PACKAGE;
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const registry = (async (input: string) => {
    asked.push(input);

    if (input === TARBALL) {
        return new Response(served);
    }

    if (input.endsWith(`/@ruimte/linux-arm64/${VERSION}`)) {
        return Response.json({ dist: { tarball: TARBALL, integrity: INTEGRITY } });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
}) as typeof fetch;

function originOf(version = VERSION) {
    return npmOrigin({
        version,
        arch: 'arm64',
        root,
        fetch: registry,
        env: {},
        run: async (run) => {
            unpacked.push(run);
            await mkdir(join(run.args[3] as string, 'package', 'bin'), { recursive: true });
            await writeFile(join(run.args[3] as string, 'package', 'bin', 'ruimte'), '');

            return 0;
        }
    });
}

async function fetchOf(version = VERSION): Promise<OriginFetch> {
    const answer = await originOf(version);

    if (!answer.ok || answer.value.fetch === null) {
        throw new Error('expected an origin to fetch');
    }

    return answer.value.fetch;
}

function hooks(lines: string[] = []) {
    return { line: (text: string) => void lines.push(text), signal: new AbortController().signal };
}

describe('Ruimte for Linux from npm', () => {
    test('names the package of the version that runs and the digest npm states, and downloads nothing yet', async () => {
        const answer = await originOf();

        expect(answer).toMatchObject({ ok: true, value: { origin: { step: null, folder: join(root, `${VERSION}-linux-arm64`, 'package', 'bin') } } });
        expect(answer.ok && answer.value.fetch?.command).toBe(`@ruimte/linux-arm64@${VERSION} from ${TARBALL}, checked against ${INTEGRITY}`);
        expect(asked).toEqual([`https://registry.npmjs.org/@ruimte/linux-arm64/${VERSION}`]);
    });

    test('ends with a plain reason for a version npm has no package of', async () => {
        expect(await originOf('0.39.0')).toEqual({
            ok: false,
            reason: 'Ruimte 0.39.0 has no Ruimte for Linux on npm, so it cannot put a machine in a container. Update Ruimte and try again.'
        });
    });

    test('downloads it once, as npm states it, into the folder the container gets', async () => {
        const fetch = await fetchOf();
        const lines: string[] = [];

        await fetch.run(hooks(lines));

        expect(existsSync(join(root, `${VERSION}-linux-arm64`, 'package', 'bin', 'ruimte'))).toBe(true);
        expect(unpacked).toHaveLength(1);

        await fetch.run(hooks(lines));

        expect(lines.at(-1)).toBe('Ruimte for Linux is here already');
        expect(asked.filter((url) => url === TARBALL)).toHaveLength(1);
    });

    test('uses no download that differs from what npm states', async () => {
        served = new TextEncoder().encode('something else');

        await expect((await fetchOf()).run(hooks())).rejects.toThrow('does not match what npm states');
        expect(unpacked).toEqual([]);
        expect(existsSync(join(root, `${VERSION}-linux-arm64`))).toBe(false);
    });
});
