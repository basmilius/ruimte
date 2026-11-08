import { describe, expect, test } from 'bun:test';
import { DEFAULT_EXTERNAL_CEILING, type ExternalGrant, type ExternalTier } from '@ruimte/contracts';
import { canvasFixture, folder, host, lineage, onDisk, projectId, started } from '../tools/canvas-test-fixture.ts';
import type { CanvasHost } from '../tools/host.ts';
import { externalActorId, isExternalActor, type ExternalCaller } from './caller.ts';
import { externalCatalog, visibleExternalTools } from './external-catalog.ts';
import { callExternalTool } from './external-route.ts';
import { APPROVAL_TOOLS, TIER_TOOLS } from './external-tiers.ts';

canvasFixture();

function grant(tier: ExternalTier, rest: Partial<ExternalGrant> = {}): ExternalGrant {
    return { tier, projects: null, ceiling: DEFAULT_EXTERNAL_CEILING, approvals: false, ...rest };
}

function caller(tier: ExternalTier = 'work', rest: Partial<ExternalGrant> = {}, id = 'cred-1'): ExternalCaller {
    return { kind: 'external', id: externalActorId(id), credentialId: id, label: 'Hosted bot', grant: grant(tier, rest) };
}

/* The fixture's host, with the projects of the machine the way `ReachHost` lists them. */
function machine(): CanvasHost {
    const base = host();

    return {
        ...base,
        reach: {
            enabled: () => false,
            open: async () => [{ projectId, name: 'repo', folder }],
            recent: async () => [{ projectId: 'closed-1', name: 'old', folder: '/nowhere/old' }],
            reopen: async () => undefined,
            ask: () => false,
            machineFolders: () => [],
            openFolder: async () => ({ projectId, name: 'repo', folder }),
            askOpen: () => false
        },
        context: {
            ...base.context!,
            answerSource: async () => ({ text: 'the body of the note' }) as never
        }
    };
}

async function call(who: ExternalCaller, name: string, input: Record<string, unknown>): Promise<{ refused: boolean; text: string }> {
    const through = machine();
    const result = await callExternalTool(visibleExternalTools(who, through), who, name, input, { host: through });
    const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');

    return { refused: result.isError === true, text };
}

describe('the tiers', () => {
    test('each tier adds to the one below it, and the approval tools stand apart', () => {
        expect(TIER_TOOLS.work).toEqual(expect.arrayContaining([...TIER_TOOLS.read]));
        expect(TIER_TOOLS.machine).toEqual(expect.arrayContaining([...TIER_TOOLS.work]));

        for (const tool of APPROVAL_TOOLS) {
            expect(Object.values(TIER_TOOLS).flat()).not.toContain(tool);
        }
    });

    test('lists only tools that exist, so a renamed tool cannot silently drop out of a tier', () => {
        const names = new Set(externalCatalog().map((tool) => tool.name));

        for (const name of TIER_TOOLS.machine) {
            expect(names.has(name), name).toBe(true);
        }
    });

    test('keeps what a client elsewhere never gets out of every tier', () => {
        const outside = ['secret_request', 'task_done', 'context_list', 'chat_attach', 'visual_write', 'plan_new', 'artifact_publish', 'device_install', 'device_media', 'language_file'];

        for (const name of outside) {
            expect(TIER_TOOLS.machine, name).not.toContain(name);
        }
    });

    test('has no tool in any tier that types into a terminal', () => {
        for (const name of TIER_TOOLS.machine) {
            expect(name, name).not.toMatch(/^(terminal|session|pty)_/);
        }
    });

    test('shows a Read credential only the tools that look', () => {
        const names = visibleExternalTools(caller('read'), machine()).map((tool) => tool.name);

        expect(names).toContain('node_list');
        expect(names).not.toContain('node_new');
        expect(names).not.toContain('agent_start');
    });

    test('answers unknown-tool for a tool outside the tier', async () => {
        const { refused, text } = await call(caller('read'), 'node_new', { project: projectId, view: 'main', kind: 'note' });

        expect(refused).toBe(true);
        expect(text).toContain('refused unknown-tool');
    });

    test('hides computer use while it is off and the approval tools while the box is off', () => {
        const names = visibleExternalTools(caller('machine'), machine()).map((tool) => tool.name);

        expect(names).not.toContain('computer_state');
        expect(names).toContain('database_query');
        expect(names).not.toContain('approval_list');
    });

    test('asks for the project on every tool but the machine-wide four', () => {
        for (const tool of visibleExternalTools(caller('machine'), machine())) {
            const required = (tool.inputSchema as { required?: string[] }).required ?? [];

            expect(required.includes('project'), tool.name).toBe(!['guide', 'project_list', 'project_open', 'project_activate'].includes(tool.name));
        }
    });
});

describe('the project', () => {
    test('lists the projects the credential reaches', async () => {
        const { refused, text } = await call(caller('read'), 'project_list', {});

        expect(refused).toBe(false);
        expect(text).toContain(`project\t${projectId}\trepo`);
        expect(text).toContain('recent\tclosed-1\told');
    });

    test('refuses a project outside the scope, and lists only the ones inside it', async () => {
        const narrow = caller('read', { projects: ['someone-else'] });

        expect((await call(narrow, 'project_list', {})).text).not.toContain(projectId);

        const { refused, text } = await call(narrow, 'node_list', { project: projectId, view: 'main' });

        expect(refused).toBe(true);
        expect(text).toContain('refused project-out-of-scope');
    });

    test('refuses a call without a project', async () => {
        const { refused, text } = await call(caller('read'), 'node_list', { view: 'main' });

        expect(refused).toBe(true);
        expect(text).toContain('refused bad-arguments');
    });

    test('checks the scope again at every call', async () => {
        const first = caller('read', { projects: [projectId] });
        const narrowed = { ...first, grant: { ...first.grant, projects: [] } };

        expect((await call(first, 'node_list', { project: projectId, view: 'main' })).refused).toBe(false);
        expect((await call(narrowed, 'node_list', { project: projectId, view: 'main' })).refused).toBe(true);
    });

    test('opens a project from Recent, and one outside the scope not at all', async () => {
        expect((await call(caller('work'), 'project_open', { project_id: 'closed-1' })).text).toContain('opened');
        expect((await call(caller('work', { projects: [projectId] }), 'project_open', { project_id: 'closed-1' })).refused).toBe(true);
    });
});

describe('a client elsewhere reads', () => {
    test('lists the nodes of a canvas by naming the canvas, with no line', async () => {
        const { refused, text } = await call(caller('read'), 'node_list', { project: projectId, view: 'main' });

        expect(refused).toBe(false);
        expect(text).toContain('term-1');
        expect(text).toContain('note-1');
    });

    test('lists the views and the lines', async () => {
        expect((await call(caller('read'), 'view_list', { project: projectId })).refused).toBe(false);
        expect((await call(caller('read'), 'link_list', { project: projectId, view: 'main' })).refused).toBe(false);
    });

    test('reads a node of a canvas it names', async () => {
        const { refused, text } = await call(caller('read'), 'context_read', { project: projectId, id: 'note-1', view: 'main' });

        expect(refused).toBe(false);
        expect(text).toContain('the body of the note');
    });
});

describe('a client elsewhere writes', () => {
    test('adds a note on a canvas it names', async () => {
        const { refused } = await call(caller('work'), 'node_new', { project: projectId, view: 'main', kind: 'note', text: 'from outside' });

        expect(refused).toBe(false);
        expect(JSON.stringify(await onDisk())).toContain('from outside');
    });

    test('writes in a note it did not make, by naming the canvas', async () => {
        const { refused, text } = await call(caller('work'), 'node_edit', { project: projectId, view: 'main', node_id: 'note-1', text: 'edited from outside' });

        expect(refused).toBe(false);
        expect(JSON.stringify(await onDisk())).toContain('edited from outside');
    });

    test('has an actor id that no node can equal', () => {
        expect(isExternalActor(caller().id)).toBe(true);
        expect(isExternalActor('term-1')).toBe(false);
    });
});

describe('agents a client elsewhere starts', () => {
    test('starts a chat at depth 0 under its credential, within the ceiling', async () => {
        const who = caller('work', { ceiling: 'supervised' });
        const { refused, text } = await call(who, 'agent_start', { project: projectId, view: 'main', cli: 'claude', prompt: 'look around', mode: 'supervised' });

        expect(refused).toBe(false);
        expect(started.at(-1)).toMatchObject({ openedBy: who.id, node: 'chat', runtimeMode: 'supervised' });
        expect(lineage.depthOf(who.id)).toBe(0);
    });

    test('refuses a mode above the ceiling on the credential, and carries the ceiling on what it starts', async () => {
        const who = caller('work', { ceiling: 'supervised' });
        const wider = await call(who, 'agent_start', { project: projectId, view: 'main', cli: 'claude', prompt: 'go', mode: 'full-access' });
        const within = await call(who, 'agent_start', { project: projectId, view: 'main', cli: 'claude', prompt: 'go' });

        expect(wider.text).toContain('refused mode-above-parent');
        expect(lineage.ceilingOf(within.text.split('\t')[0]!)).toBe('supervised');
    });
});
