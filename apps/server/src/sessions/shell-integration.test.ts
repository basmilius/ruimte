import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareShellIntegration } from './shell-integration.ts';

test('shell integration only changes the environment of supported Ruimte shells', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-shell-env-'));
    try {
        const integrate = await prepareShellIntegration(home, 'darwin');
        const zsh: Record<string, string> = { HOME: '/home/person', ZDOTDIR: '/custom' };
        integrate('/bin/zsh', zsh);
        expect(zsh.RUIMTE_USER_ZDOTDIR).toBe('/custom');
        expect(zsh.ZDOTDIR).toBe(join(home, 'shell-integration/zsh'));
        const bash: Record<string, string> = { PROMPT_COMMAND: 'existing_hook;' };
        integrate('/usr/local/bin/bash', bash);
        expect(bash).toEqual({ PROMPT_COMMAND: 'existing_hook;' });
        const fish = { HOME: '/home/person' };
        integrate('/bin/fish', fish);
        expect(fish).toEqual({ HOME: '/home/person' });
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('on Windows Git Bash reports its cwd through PROMPT_COMMAND, before whatever was there', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-shell-env-'));
    try {
        const integrate = await prepareShellIntegration(home, 'win32');
        const bash: Record<string, string> = { PROMPT_COMMAND: 'existing_hook' };
        integrate(String.raw`C:\Program Files\Git\bin\bash.exe`, bash);
        expect(bash.PROMPT_COMMAND).toBe('_ruimte_output_cwd;existing_hook');
        expect(bash['BASH_FUNC__ruimte_output_cwd%%']).toStartWith('() {');
        const fresh: Record<string, string> = {};
        integrate('bash', fresh);
        expect(fresh.PROMPT_COMMAND).toBe('_ruimte_output_cwd');
        const pwsh = { HOME: 'C:\\Users\\person' };
        integrate('pwsh.exe', pwsh);
        expect(pwsh).toEqual({ HOME: 'C:\\Users\\person' });
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});
