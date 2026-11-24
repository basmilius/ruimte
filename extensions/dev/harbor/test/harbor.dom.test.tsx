import { describe, expect, test } from 'bun:test';
import { createTestHost, createTestServer } from '@ruimte/extension/testing';
import type { HarborServer } from '../server';

const SHELL = { id: 'shell-1', kind: 'terminal', title: 'Shell' };

describe('Harbor', () => {
    test('opens a shell with its profile from the canvas menu, and types its first command into it', async () => {
        const host = await createTestHost();

        expect(await host.run(host.action('shell'), 'canvasMenu')).toEqual({ ok: true, value: undefined });
        expect(host.terminals).toEqual([
            {
                id: 'terminal-1',
                openedBy: 'extension',
                needsYou: false,
                profile: 'service-shell',
                title: 'Harbor',
                written: ['echo "Harbor: $HARBOR_SERVICE"\n']
            }
        ]);
    });

    test('opens its shell beside a terminal, and leaves that terminal itself alone', async () => {
        const host = await createTestHost({ project: { nodes: [SHELL] } });

        expect(host.slot(host.action('shell'), 'nodeMenu', { node: SHELL })?.title).toBe('Harbor shell beside this');
        expect(await host.run(host.action('shell'), 'nodeMenu', { node: SHELL })).toEqual({ ok: true, value: undefined });
        expect(host.terminals.map((terminal) => terminal.id)).toEqual(['terminal-1']);
        expect(host.calls.filter((call) => call.method === 'terminals.write').map((call) => call.args[0])).toEqual([{ id: 'terminal-1' }]);
    });

    test('shows the person why no shell opened when its profile is not one the manifest supplies', async () => {
        const host = await createTestHost({ manifest: { provides: {} } });

        expect(await host.run(host.action('shell'), 'canvasMenu')).toMatchObject({
            ok: false,
            error: { message: 'dev.harbor supplies no terminal profile service-shell' }
        });
        expect(host.terminals).toEqual([]);
    });

    test('shows the last line of the terminal a person reads it from', async () => {
        const host = await createTestHost({ project: { nodes: [{ ...SHELL, text: '$ make\nBuilt in 2s\n' }] } });

        expect(await host.run(host.action('last-line'), 'terminalMenu', { node: SHELL })).toEqual({ ok: true, value: undefined });
        expect(host.notifications).toEqual([{ text: 'Built in 2s', tone: 'neutral' }]);
    });

    test('keeps the service of a project on the machine, where the shell it opens next reads it', async () => {
        const server = await createTestServer<HarborServer>();
        const host = await createTestHost({ project: { id: 'project-1' }, answers: { server } });
        const card = await host.render(host.card('service'));

        expect(card.text()).toBe('web (shells open here)apidb');

        await card.click('db');
        await card.until(() => card.find('db (shells open here)') !== null);

        expect(server.storage).toEqual({ 'service:project-1': 'db' });
        expect(await host.run(host.action('shell-view'), 'commandPalette')).toEqual({ ok: true, value: undefined });
        expect(server.terminals[0]?.spawn?.env).toEqual({ HARBOR_SERVICE: 'db', HARBOR_WORKDIR: '/var/lib/postgresql' });
    });

    test('shows which services of the compose file run, as their launches start and end', async () => {
        const server = await createTestServer<HarborServer>();
        const host = await createTestHost({ project: { id: 'project-1' }, answers: { server } });
        const card = await host.render(host.card('service'));
        // A launch changes on the machine, and what `server/` then says reaches the card as a client hears it.
        const launchIs = (state: 'running' | 'exited'): void => {
            server.fire('launch.status', { project: { id: 'project-1' }, launch: 'dev.harbor:compose:web', state, exitCode: state === 'exited' ? 0 : null });

            const said = server.emitted.at(-1);

            host.emit(said?.name ?? '', said?.payload);
        };

        expect(card.find('Running: web')).toBeNull();

        launchIs('running');
        await card.until(() => card.find('Running: web') !== null);

        launchIs('exited');
        await card.until(() => card.find('Running: web') === null);
    });
});
