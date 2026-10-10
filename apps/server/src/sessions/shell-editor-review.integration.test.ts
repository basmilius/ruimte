import { expect, test } from 'bun:test';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { realShell } from './shell-editor-test-helpers.ts';
import { relayedShell } from './shell-editor-relay-test-helpers.ts';
import { waitFor, waitForAsync } from './test-helpers.ts';

for (const startup of ['.zshenv', '.zshrc']) {
    for (const options of ['nounset', 'errexit', 'nounset errexit']) {
        test(`strict ${startup} ${options} preserves startup, options, status and subsequent editor input`, async () => {
            const rc = `PS1='strict [%?]> '\n${startup === '.zshrc' ? `setopt ${options}\n` : ''}`;
            const env = startup === '.zshenv' ? `setopt ${options}\n` : '';
            const fixture = await realShell(() => rc, { zshenv: env });
            try {
                await fixture.ready();
                expect(fixture.session.exited).toBe(false);
                expect(fixture.output()).not.toMatch(/parameter not set|no such option|review-error-context/);
                expect(await fixture.session.plainText()).toContain('strict [0]>');
                fixture.manager.write('shell', 'printf "%s|%s" "$options[errexit]" "$options[nounset]" > options; printf alive > ordinary-input\r', 'person');
                await waitForAsync(() => Bun.file(join(fixture.home, 'ordinary-input')).exists(), 'normal shell input');
                expect(await readFile(join(fixture.home, 'ordinary-input'), 'utf8')).toBe('alive');
                expect(await readFile(join(fixture.home, 'options'), 'utf8')).toBe(
                    `${options.includes('errexit') ? 'on' : 'off'}|${options.includes('nounset') ? 'on' : 'off'}`
                );
                await fixture.ready();
                fixture.manager.write('shell', 'false && :\r', 'person');
                await waitForAsync(async () => (await fixture.session.plainText()).includes('strict [1]>'), 'prior command status');
                await fixture.ready();
                const preview = await fixture.preview();
                expect(preview.targets).toHaveLength(1);
                await fixture.prepare.prepare('owner', preview.targets[0]!.token, fixture.client);
                expect(await fixture.session.plainText()).toContain('echo chosen > chosen');
                await expect(access(join(fixture.home, 'chosen'))).rejects.toThrow();
                expect(await readFile(join(fixture.home, '.zshenv'), 'utf8')).toBe(env);
                expect(await readFile(join(fixture.home, '.zshrc'), 'utf8')).toBe(rc);
                expect(fixture.output()).not.toMatch(/parameter not set|no such option|review-error-context/);
            } finally {
                await fixture.cleanup();
            }
        });
    }
}

test('an unavailable editor socket cannot terminate a strict interactive shell', async () => {
    const fixture = await realShell((home) => `PS1='offline> '\nsetopt nounset errexit\n_ruimte_editor_path='${home}/missing.sock'\n`);
    try {
        await waitFor(() => fixture.output().includes('offline>'), 'ordinary prompt');
        expect(fixture.session.exited).toBe(false);
        expect((await fixture.preview()).targets).toEqual([]);
        fixture.manager.write('shell', 'printf alive > ordinary-input\r', 'person');
        await waitForAsync(() => Bun.file(join(fixture.home, 'ordinary-input')).exists(), 'normal input without integration');
        expect(await readFile(join(fixture.home, 'ordinary-input'), 'utf8')).toBe('alive');
        expect(fixture.output()).not.toMatch(/parameter not set|no such option/);
    } finally {
        await fixture.cleanup();
    }
});

for (const change of ['partial-key', 'type-and-clear', 'decoder-only'] as const) {
    test(`a delayed prepare cannot insert after ${change} beyond dispatch`, async () => {
        const fixture = await relayedShell();
        try {
            await fixture.ready();
            const preview = await fixture.preview();
            const pending = fixture.prepare.prepare('owner', preview.targets[0]!.token, fixture.client);
            await waitFor(fixture.hasHeld, 'prepare frame reaching relay');
            if (change === 'decoder-only') {
                fixture.queuedInput('\x1b[');
            } else {
                fixture.manager.write('shell', change === 'partial-key' ? '\x1b[' : 'typed\x15', 'person');
            }
            const empty = change === 'type-and-clear';
            await waitForAsync(async () => (await fixture.session.shellPrompt.inspect())?.empty === empty, 'editor consuming tty bytes');
            fixture.forward();
            await expect(pending).rejects.toMatchObject({ code: 'terminal-editor-refused' });
            expect(await readdir(dirname(fixture.editorAddress))).toEqual(['editor.sock']);
            expect(await fixture.session.plainText()).not.toContain('echo chosen > chosen');
            await expect(access(join(fixture.home, 'chosen'))).rejects.toThrow();
            if (!empty) {
                expect((await fixture.preview()).targets).toEqual([]);
                fixture.manager.write('shell', 'D', 'person');
            }
            await waitForAsync(async () => (await fixture.session.shellPrompt.inspect())?.empty === true, 'decoder completing');
            const next = await fixture.preview();
            expect(next.targets).toHaveLength(1);
            const reused = fixture.prepare.prepare('owner', next.targets[0]!.token, fixture.client);
            await waitFor(fixture.hasHeld, 'next prepare reaching relay');
            fixture.forward();
            await expect(reused).resolves.toEqual({ sessionId: 'shell' });
            expect(await readdir(dirname(fixture.editorAddress))).toEqual(['editor.sock']);
            expect(await fixture.session.plainText()).toContain('echo chosen > chosen');
            await expect(access(join(fixture.home, 'chosen'))).rejects.toThrow();
        } finally {
            await fixture.cleanup();
        }
    });
}

for (const loss of ['timeout', 'disconnect']) {
    test(`a real filled editor with a lost acknowledgement (${loss}) is unconfirmed and never retried`, async () => {
        const fixture = await realShell(
            () =>
                `PS1='ack> '\nprint() { if [[ "$*" == *$'\\tprepared' ]]; then ${loss === 'disconnect' ? '_ruimte_editor_close; ' : ''}return 0; fi; builtin print "$@"; }\n`
        );
        try {
            await fixture.ready();
            const preview = await fixture.preview();
            const token = preview.targets[0]!.token;
            await expect(fixture.prepare.prepare('owner', token, fixture.client)).rejects.toMatchObject({ code: 'terminal-prepare-unconfirmed' });
            expect(await readdir(dirname(fixture.editorAddress))).toEqual(['editor.sock']);
            expect(await fixture.session.plainText()).toContain('echo chosen > chosen');
            await expect(access(join(fixture.home, 'chosen'))).rejects.toThrow();
            expect((await fixture.preview()).targets).toEqual([]);
            await expect(fixture.prepare.prepare('owner', token, fixture.client)).rejects.toThrow('no longer available');
        } finally {
            await fixture.cleanup();
        }
    });
}

test('initial hook installation preserves the previous startup status', async () => {
    const fixture = await realShell(() => "PS1='startup [%?]> '\nfalse\n");
    try {
        await fixture.ready();
        expect(await fixture.session.plainText()).toContain('startup [1]>');
    } finally {
        await fixture.cleanup();
    }
});

test('an older shell integration without cancellation support stays ineligible', async () => {
    const fixture = await realShell(
        () =>
            `PS1='legacy> '\n_ruimte_editor_open() { emulate -L zsh; zsocket "$_ruimte_editor_path" || return 0; typeset -g _ruimte_editor_fd=$REPLY; print -r -u "$_ruimte_editor_fd" -- $'hello\\t'"$_ruimte_editor_secret"$'\\t'"$$"; zle -F -w "$_ruimte_editor_fd" _ruimte_editor_read; }\n`
    );
    try {
        await waitFor(() => fixture.output().includes('legacy>'), 'ordinary legacy prompt');
        expect(await fixture.session.shellPrompt.workingDirectory()).toEqual({ state: 'unknown' });
        expect((await fixture.preview()).targets).toEqual([]);
        fixture.manager.write('shell', 'printf alive > ordinary-input\r', 'person');
        await waitForAsync(() => Bun.file(join(fixture.home, 'ordinary-input')).exists(), 'normal legacy input');
        expect(await readFile(join(fixture.home, 'ordinary-input'), 'utf8')).toBe('alive');
    } finally {
        await fixture.cleanup();
    }
});
