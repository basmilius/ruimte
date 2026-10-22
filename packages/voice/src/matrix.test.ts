import { describe, expect, test } from 'bun:test';
import { ACTION_DEFINITIONS, VOICE_CONTROL_TOOL } from '@ruimte/actions';
import { DAEMON_VOICE_ACTIONS, daemonVoiceTools } from './matrix.ts';

/* What every response of a daemon Voice session carries; the whole domain set is about 48 KB. */
const MAX_TOOL_BYTES = 10 * 1024;

function bytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}

function offered(): string[] {
    return daemonVoiceTools()
        .filter((tool) => tool.name !== VOICE_CONTROL_TOOL)
        .flatMap((tool) => (tool.parameters.properties.action?.enum as string[] | undefined) ?? []);
}

describe('the daemon Voice matrix', () => {
    test('names each action once, and only actions of the catalog', () => {
        const names = DAEMON_VOICE_ACTIONS.map((action) => action.name);
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
            expect(Object.hasOwn(ACTION_DEFINITIONS, name)).toBe(true);
        }
    });

    test('reads, moves between the projects of its machine, and prompts, clears or starts a chat', () => {
        expect(DAEMON_VOICE_ACTIONS.map((action) => action.name)).toEqual([
            'project.list',
            'project.switch',
            'workspace.inspect',
            'target.resolve',
            'chat.read',
            'chat.inspect',
            'agents.inspect',
            'chat.send',
            'chat.clear',
            'agent.start'
        ]);
        for (const action of DAEMON_VOICE_ACTIONS) {
            if (action.name === 'chat.send' || action.name === 'chat.clear' || action.name === 'agent.start') {
                continue;
            }
            // A switch moves only the session, which the daemon keeps; it writes nothing a project holds.
            expect(ACTION_DEFINITIONS[action.name].effect).toBe(action.name === 'project.switch' ? 'local' : 'read');
        }
        expect(offered()).toContain('chat.send');
        expect(offered()).toContain('agent.start');
    });

    test('only a deletion asks first, as desktop Voice does by default', () => {
        expect(DAEMON_VOICE_ACTIONS.filter((action) => action.confirms).map((action) => action.name)).toEqual(['chat.clear']);
        expect(offered()).toContain('chat.clear');
    });

    test('a tool on a phone never promises what only a window has', () => {
        const said = daemonVoiceTools()
            .map((tool) => tool.description)
            .join('\n');
        expect(said).not.toMatch(/the selection|split grid|cells of the grid|on screen|terminal\.(read|clear)/i);
    });

    test('offer exactly the matrix actions Voice may run, and the control tool only when one asks first', () => {
        const reachable = DAEMON_VOICE_ACTIONS.map((action) => action.name).filter((name) => ACTION_DEFINITIONS[name].actors.includes('voice'));
        expect([...offered()].sort()).toEqual([...reachable].sort());
        const control = daemonVoiceTools().some((tool) => tool.name === VOICE_CONTROL_TOOL);
        expect(control).toBe(DAEMON_VOICE_ACTIONS.some((action) => action.confirms));
    });

    test('stay under the byte bound', () => {
        expect(bytes(daemonVoiceTools())).toBeLessThan(MAX_TOOL_BYTES);
    });
});
