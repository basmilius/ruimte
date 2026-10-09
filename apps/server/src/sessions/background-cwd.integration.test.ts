import { expect, test } from 'bun:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { realShell } from './shell-editor-test-helpers';
import { waitForAsync } from './test-helpers';

for (const tostop of [true, false]) {
    test(`redirected background cwd output completes with tostop=${tostop}`, async () => {
        const shell = await realShell();
        try {
            await mkdir(join(shell.home, 'nested'));
            await shell.ready();
            shell.manager.write(
                'shell',
                `review_root=$PWD; stty ${tostop ? 'tostop' : '-tostop'}; stty -g >tty-before; setopt >options-before; trap >traps-before; ( setopt errexit nounset errreturn; setopt >"$review_root/child-options-before"; trap >"$review_root/child-traps-before"; cd nested >/dev/null 2>&1; setopt >"$review_root/child-options-after"; trap >"$review_root/child-traps-after"; print -r -- PERSON_STDOUT; print -ru2 -- PERSON_STDERR; print -r -- "completed:$PWD" >"$review_root/completed" ) >background.out 2>background.err & job=$!; print -r -- $job >job-pid\r`,
                'person'
            );
            await waitForAsync(() => Bun.file(join(shell.home, 'completed')).exists(), 'redirected background completion', 1000).catch(() => {
                throw new Error(JSON.stringify(shell.output()));
            });
            expect(await readFile(join(shell.home, 'completed'), 'utf8')).toBe(`completed:${shell.home}/nested\n`);
            shell.manager.write(
                'shell',
                'wait $job; print -r -- $? >job-status; stty -g >tty-after; setopt >options-after; trap >traps-after; jobs -p >remaining; print -r -- done >checked\r',
                'person'
            );
            await waitForAsync(() => Bun.file(join(shell.home, 'checked')).exists(), 'background job reaped', 1000);
            expect(await readFile(join(shell.home, 'job-status'), 'utf8')).toBe('0\n');
            expect(await readFile(join(shell.home, 'background.out'), 'utf8')).toBe('PERSON_STDOUT\n');
            expect(await readFile(join(shell.home, 'background.err'), 'utf8')).toBe('PERSON_STDERR\n');
            expect(await readFile(join(shell.home, 'remaining'), 'utf8')).toBe('');
            expect(shell.output()).not.toContain('suspended (tty output)');
            expect(shell.output()).toContain('\x1b]7;unknown\x07');
            for (const state of ['tty', 'options', 'traps', 'child-options', 'child-traps']) {
                expect(await readFile(join(shell.home, `${state}-after`), 'utf8')).toBe(await readFile(join(shell.home, `${state}-before`), 'utf8'));
            }
        } finally {
            await cleanupJob(shell);
        }
    });
}

test('ordinary background tty output still stops after the cwd hook returns', async () => {
    const shell = await realShell();
    try {
        await mkdir(join(shell.home, 'nested'));
        await shell.ready();
        shell.manager.write(
            'shell',
            'review_root=$PWD; stty tostop; ( cd nested >/dev/null 2>&1; print -r -- reached >"$review_root/past-hook"; print -r -- PERSON_TTY >/dev/tty; print -r -- wrong >"$review_root/completed" ) >background.out 2>background.err & job=$!; print -r -- $job >job-pid\r',
            'person'
        );
        await waitForAsync(() => Bun.file(join(shell.home, 'past-hook')).exists(), 'metadata hook returning', 1000);
        await waitForAsync(async () => shell.output().includes('suspended (tty output)'), 'ordinary tty write suspending', 1000);
        expect(await Bun.file(join(shell.home, 'completed')).exists()).toBe(false);
        expect(await readFile(join(shell.home, 'background.out'), 'utf8')).toBe('');
        expect(await readFile(join(shell.home, 'background.err'), 'utf8')).toBe('');
    } finally {
        await cleanupJob(shell);
    }
});

for (const trap of ['default', 'ignored', 'list', 'function'] as const) {
    test(`foreground subshell cwd metadata restores the person's ${trap} TTOU disposition and options`, async () => {
        const shell = await realShell();
        try {
            await mkdir(join(shell.home, 'nested'));
            await shell.ready();
            const install =
                trap === 'list'
                    ? `trap 'print -r -- handled >>"$review_root/handled"' TTOU`
                    : trap === 'function'
                      ? 'TRAPTTOU() { print -r -- handled >>"$review_root/handled"; }'
                      : `trap ${trap === 'ignored' ? "''" : '-'} TTOU`;
            shell.manager.write(
                'shell',
                `review_root=$PWD; stty tostop; ( zmodload zsh/system; ${install}; unsetopt localtraps; setopt errexit nounset errreturn; stty -g >tty-before; setopt >options-before; trap >traps-before; cd nested >/dev/null 2>&1; if (exit 37); then :; else if _ruimte_output_cwd; then hook_status=0; else hook_status=$?; fi; fi; print -r -- $hook_status >"$review_root/status"; stty -g >"$review_root/tty-after"; setopt >"$review_root/options-after"; trap >"$review_root/traps-after"; ${trap === 'list' || trap === 'function' ? 'kill -s TTOU $sysparams[pid]; ' : ''}print -r -- done >"$review_root/checked" )\r`,
                'person'
            );
            await waitForAsync(() => Bun.file(join(shell.home, 'checked')).exists(), 'foreground hook checks', 1000).catch(() => {
                throw new Error(JSON.stringify(shell.output()));
            });
            expect(await readFile(join(shell.home, 'status'), 'utf8')).toBe('37\n');
            for (const state of ['tty', 'options', 'traps']) {
                expect(await readFile(join(shell.home, `${state}-after`), 'utf8')).toBe(await readFile(join(shell.home, `${state}-before`), 'utf8'));
            }
            if (trap === 'list' || trap === 'function') {
                expect(await readFile(join(shell.home, 'handled'), 'utf8')).toBe('handled\n');
            }
        } finally {
            await shell.cleanup();
        }
    });
}

async function cleanupJob(shell: Awaited<ReturnType<typeof realShell>>): Promise<void> {
    try {
        const pid = Number(await readFile(join(shell.home, 'job-pid'), 'utf8').catch(() => '0'));
        if (pid > 0) {
            try {
                // A stopped job cannot run shell cleanup; kill only this fixture's recorded process group.
                process.kill(-pid, 'SIGKILL');
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                    throw error;
                }
            }
            shell.manager.write('shell', 'if wait $job; then :; else :; fi; print -r -- done >"$review_root/job-cleanup"\r', 'person');
            await waitForAsync(() => Bun.file(join(shell.home, 'job-cleanup')).exists(), 'background job reaped after cleanup', 1000);
        }
    } finally {
        await shell.cleanup();
    }
}
