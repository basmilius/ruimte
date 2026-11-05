import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Step {
    readonly name?: string;
    readonly run?: string;
}

const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dir, '../.github/workflows/release.yml'), 'utf8')) as {
    jobs: { draft: { steps: Step[] } };
};
const draftScript = workflow.jobs.draft.steps.find((step) => step.name === 'The draft release, before anything uploads')?.run ?? '';

const root = mkdtempSync(join(realpathSync(tmpdir()), 'ruimte-release-draft-'));

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

/*
 * A `gh` that answers `release create` with the given lines in turn, one per attempt, and `release view` with
 * whether a create succeeded so far. A line `ok` succeeds; `ok-lost` succeeds on GitHub but answers a 502.
 */
function fakeGh(folder: string, answers: string[]): void {
    const bin = join(folder, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(folder, 'answers'), `${answers.join('\n')}\n`);
    writeFileSync(
        join(bin, 'gh'),
        [
            '#!/bin/bash',
            `state="${folder}"`,
            'if [ "$2" = view ]; then [ -e "$state/created" ]; exit; fi',
            'echo create >> "$state/calls"',
            'answer=$(sed -n "$(wc -l < "$state/calls" | tr -d " ")p" "$state/answers")',
            'case "$answer" in',
            '    ok) touch "$state/created"; exit 0 ;;',
            '    ok-lost) touch "$state/created"; echo "HTTP 502: Bad Gateway"; exit 1 ;;',
            '    *) echo "$answer"; exit 1 ;;',
            'esac'
        ].join('\n')
    );
    chmodSync(join(bin, 'gh'), 0o755);
}

async function draft(name: string, answers: string[]): Promise<{ code: number; creates: number; output: string }> {
    const folder = join(root, name);
    mkdirSync(folder, { recursive: true });
    fakeGh(folder, answers);
    const child = Bun.spawn(['bash', '-e', '-c', draftScript], {
        cwd: folder,
        env: { PATH: `${join(folder, 'bin')}:/usr/bin:/bin`, GITHUB_REF_NAME: 'v1.2.3', RUNNER_TEMP: folder, RELEASE_RETRY_PAUSE: '0' },
        stdout: 'pipe',
        stderr: 'pipe'
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const calls = (() => {
        try {
            return readFileSync(join(folder, 'calls'), 'utf8').trim().split('\n').length;
        } catch {
            return 0;
        }
    })();

    return { code, creates: calls, output: stdout + stderr };
}

describe('the draft step of release.yml', () => {
    test.each([
        ['a 500 and a 502 before it lands', ['HTTP 500: Internal Server Error', 'HTTP 502: Bad Gateway', 'ok'], 0, 3],
        ['a create that landed but answered a 502', ['ok-lost'], 0, 1],
        ['a release that already exists', ['a release with the same tag name already exists'], 0, 1],
        ['GitHub down on every attempt', ['HTTP 500', 'HTTP 500', 'HTTP 500', 'HTTP 500', 'HTTP 500', 'ok'], 1, 5]
    ])('%s', async (name, answers, code, creates) => {
        const result = await draft(name.replaceAll(' ', '-'), answers);

        expect({ code: result.code, creates: result.creates }).toEqual({ code, creates });
    });
});
