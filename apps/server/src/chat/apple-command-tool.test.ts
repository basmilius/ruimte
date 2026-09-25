import { describe, expect, test } from 'bun:test';
import { executeAppleCommand, type AppleCommandDependencies } from './apple-command-tool.ts';

const harness = () => {
    let output!: ReadableStreamDefaultController<Uint8Array>;
    let errors!: ReadableStreamDefaultController<Uint8Array>;
    let finish!: (code: number) => void;
    let timeout!: () => void;
    let milliseconds = 0;
    let kills = 0;
    let cleared = false;
    const starts: Array<{ cwd: string; command: string; env: Record<string, string | undefined> }> = [];
    const exited = new Promise<number>((resolve) => {
        finish = resolve;
    });
    const dependencies: AppleCommandDependencies = {
        spawn: (cwd, command, env) => {
            starts.push({ cwd, command, env });
            return {
                stdout: new ReadableStream({
                    start: (controller) => {
                        output = controller;
                    }
                }),
                stderr: new ReadableStream({
                    start: (controller) => {
                        errors = controller;
                    }
                }),
                exited,
                killGroup: () => {
                    kills++;
                    if (kills === 1) {
                        output.close();
                        errors.close();
                        finish(137);
                    }
                }
            };
        },
        scheduleTimeout: (callback, duration) => {
            timeout = callback;
            milliseconds = duration;
            return () => {
                cleared = true;
            };
        }
    };
    return {
        dependencies,
        starts,
        out: (text: string) => output.enqueue(new TextEncoder().encode(text)),
        err: (text: string) => errors.enqueue(new TextEncoder().encode(text)),
        finish: (code: number) => finish(code),
        timeout: () => timeout(),
        state: () => ({ kills, cleared, milliseconds })
    };
};

describe('Apple approved local shell command', () => {
    test('passes the approved command verbatim, inherits the provided environment, and captures output', async () => {
        const rig = harness();
        const pending = executeAppleCommand('/project', 'printf hello && printf warning >&2', undefined, { PATH: '/bin', TEST: '1' }, rig.dependencies);
        rig.out('hello');
        rig.err('warning');
        rig.finish(0);
        const result = await pending;
        expect(rig.starts).toEqual([{ cwd: '/project', command: 'printf hello && printf warning >&2', env: { PATH: '/bin', TEST: '1' } }]);
        expect(result.failed).toBe(false);
        expect(JSON.parse(result.output)).toMatchObject({ exitCode: 0, timedOut: false, truncated: false });
        expect(JSON.parse(result.output).output).toContain('hello');
        expect(JSON.parse(result.output).output).toContain('warning');
        expect(rig.state()).toMatchObject({ milliseconds: 30_000, cleared: true });
        expect(rig.state().kills).toBeGreaterThan(0);
    });

    test('reports nonzero exit and still retains stderr', async () => {
        const rig = harness();
        const pending = executeAppleCommand('/project', 'build', undefined, {}, rig.dependencies);
        rig.err('compiler error');
        rig.finish(2);
        const result = await pending;
        expect(result.failed).toBe(true);
        expect(JSON.parse(result.output)).toMatchObject({ exitCode: 2, output: 'compiler error' });
    });

    test('bounds serialized UTF-8 and escaped output with a truncation marker', async () => {
        const rig = harness();
        const pending = executeAppleCommand('/project', 'verbose', undefined, {}, rig.dependencies);
        rig.out('\0'.repeat(6000));
        rig.finish(0);
        const result = await pending;
        expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(6000);
        expect(JSON.parse(result.output)).toMatchObject({ truncated: true, note: 'Output was truncated.' });
    });

    test('timeout kills the process group and returns retained partial output', async () => {
        const rig = harness();
        const pending = executeAppleCommand('/project', 'slow', undefined, {}, rig.dependencies);
        rig.out('progress so far');
        await Promise.resolve();
        rig.timeout();
        const result = await pending;
        expect(result.failed).toBe(true);
        expect(JSON.parse(result.output)).toMatchObject({
            timedOut: true,
            output: 'progress so far',
            note: 'Command stopped after 30 seconds; output is partial.'
        });
        expect(rig.state().kills).toBeGreaterThan(0);
        expect(rig.state().cleared).toBe(true);
    });

    test('abort kills the process group and rejects instead of returning late output', async () => {
        const rig = harness();
        const controller = new AbortController();
        const pending = executeAppleCommand('/project', 'slow', controller.signal, {}, rig.dependencies);
        controller.abort();
        await expect(pending).rejects.toThrow();
        expect(rig.state().kills).toBeGreaterThan(0);
        expect(rig.state().cleared).toBe(true);
    });

    test('already canceled or invalid commands never spawn', async () => {
        const rig = harness();
        const controller = new AbortController();
        controller.abort();
        await expect(executeAppleCommand('/project', 'command', controller.signal, {}, rig.dependencies)).rejects.toThrow();
        for (const command of ['', '  ', 'bad\0command', 'a'.repeat(16_001)]) {
            await expect(executeAppleCommand('/project', command, undefined, {}, rig.dependencies)).rejects.toThrow();
        }
        expect(rig.starts).toHaveLength(0);
    });
});
