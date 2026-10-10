import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareShellIntegration } from './shell-integration.ts';

test('shell integration only changes the environment of supported Ruimte shells', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-shell-env-'));
    try {
        const integrate = await prepareShellIntegration(home);
        const zsh: Record<string, string> = { HOME: '/home/person', ZDOTDIR: '/custom' };
        integrate('/bin/zsh', zsh);
        expect(zsh.RUIMTE_USER_ZDOTDIR).toBe('/custom');
        expect(zsh.ZDOTDIR).toBe(join(home, 'shell-integration/zsh'));
        expect(await readFile(join(zsh.ZDOTDIR!, '.zshenv'), 'utf8')).toContain('source "${ZDOTDIR:-$HOME}/.zshenv"');
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
