import { describe, expect, test } from 'bun:test';
import { ACTION_DEFINITIONS, VOICE_CONTROL_TOOL } from '@ruimte/actions';
import { DAEMON_VOICE_ACTIONS, daemonVoiceActions, daemonVoiceTools } from './matrix.ts';

/* What every response of a daemon Voice session carries; the whole domain set is about 48 KB. */
const MAX_TOOL_BYTES = 10 * 1024;

function bytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}

function offered(writes: boolean): string[] {
    return daemonVoiceTools({ writes }).flatMap((tool) => (tool.parameters.properties.action?.enum as string[] | undefined) ?? []);
}

describe('the daemon Voice matrix', () => {
    test('names each action once, and only actions of the catalog', () => {
        const names = DAEMON_VOICE_ACTIONS.map((action) => action.name);
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
            expect(Object.hasOwn(ACTION_DEFINITIONS, name)).toBe(true);
        }
    });

    test('marks prompting and starting a chat as writes, and nothing else', () => {
        expect(DAEMON_VOICE_ACTIONS.filter((action) => action.writes).map((action) => action.name)).toEqual(['chat.send', 'agent.start']);
    });

    test('without writes Voice only reads, and moves between the projects of its machine', () => {
        const actions = daemonVoiceActions({ writes: false });
        expect(actions.map((action) => action.name)).toEqual([
            'project.list',
            'project.switch',
            'workspace.inspect',
            'target.resolve',
            'chat.read',
            'chat.inspect',
            'agents.inspect'
        ]);
        for (const action of actions) {
            // A switch moves only the session, which the daemon keeps; it writes nothing a project holds.
            expect(ACTION_DEFINITIONS[action.name].effect).toBe(action.name === 'project.switch' ? 'local' : 'read');
        }
        expect(offered(false)).not.toContain('chat.send');
    });

    test('with writes the tools carry chat.send and agent.start too', () => {
        expect(offered(true)).toContain('chat.send');
        expect(offered(true)).toContain('agent.start');
    });

    test('a tool on a phone never promises what only a window has', () => {
        for (const writes of [false, true]) {
            const said = daemonVoiceTools({ writes })
                .map((tool) => tool.description)
                .join('\n');
            expect(said).not.toMatch(/the selection|split grid|cells of the grid|on screen|clear|terminal\.read/i);
        }
        const reads = daemonVoiceTools({ writes: false })
            .map((tool) => tool.description)
            .join('\n');
        expect(reads).not.toContain('send it a prompt');
    });

    test('offer exactly the matrix actions Voice may run, and the control tool only when one asks first', () => {
        for (const writes of [false, true]) {
            const reachable = daemonVoiceActions({ writes })
                .map((action) => action.name)
                .filter((name) => ACTION_DEFINITIONS[name].actors.includes('voice'));
            expect([...offered(writes)].sort()).toEqual([...reachable].sort());
            const control = daemonVoiceTools({ writes }).some((tool) => tool.name === VOICE_CONTROL_TOOL);
            expect(control).toBe(daemonVoiceActions({ writes }).some((action) => action.confirms));
        }
    });

    test('stay under the byte bound', () => {
        expect(bytes(daemonVoiceTools({ writes: false }))).toBeLessThan(MAX_TOOL_BYTES);
        expect(bytes(daemonVoiceTools({ writes: true }))).toBeLessThan(MAX_TOOL_BYTES);
    });
});
