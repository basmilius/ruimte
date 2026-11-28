import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { runMachineStep } from './machine-steps.ts';

const ENV = { PATH: process.env.PATH };

function run(script: string, signal = new AbortController().signal): Promise<{ code: number | null; lines: string[] }> {
    const lines: string[] = [];

    return runMachineStep({ command: 'sh', args: ['-c', script], cwd: tmpdir(), env: ENV }, { line: (text) => lines.push(text), signal }).then((code) => ({
        code,
        lines
    }));
}

describe.skipIf(process.platform === 'win32')('runMachineStep with a real process', () => {
    test('hands on the lines of both streams, a last one without a line end too, and answers the exit code', async () => {
        const { code, lines } = await run('echo one; echo two >&2; printf three; exit 3');

        expect(code).toBe(3);
        expect(lines.toSorted()).toEqual(['one', 'three', 'two']);
    });

    test('gives the program the variables of its step and nothing a shell would expand', async () => {
        const lines: string[] = [];
        const code = await runMachineStep(
            { command: 'sh', args: ['-c', 'echo "$HARBOR_MACHINE" "$1"', 'sh', '$(id)'], cwd: tmpdir(), env: { ...ENV, HARBOR_MACHINE: 'workbench' } },
            { line: (text) => lines.push(text), signal: new AbortController().signal }
        );

        expect([code, lines]).toEqual([0, ['workbench $(id)']]);
    });

    test('rejects for a program that is not there', async () => {
        await expect(
            runMachineStep(
                { command: 'ruimte-no-such-program', args: [], cwd: tmpdir(), env: ENV },
                { line: () => undefined, signal: new AbortController().signal }
            )
        ).rejects.toThrow();
    });

    test('asks a program to end once a person stopped it, and answers when it did', async () => {
        const abort = new AbortController();
        const lines: string[] = [];
        const ended = runMachineStep(
            // `exec`, so the signal reaches the program that waits rather than a shell around it.
            { command: 'sh', args: ['-c', 'echo up; exec sleep 600'], cwd: tmpdir(), env: ENV },
            {
                line: (text) => {
                    lines.push(text);
                    abort.abort();
                },
                signal: abort.signal
            }
        );

        expect(await ended).toBeNull();
        expect(lines).toEqual(['up']);
    });
});
