import { describe, expect, test } from 'bun:test';
import { ACTION_ACTOR_KINDS, ACTION_DEFINITIONS, VOICE_CONTROL_TOOL, voiceToolDefinitions, type ActionName } from '@ruimte/actions';
import { DAEMON_VOICE_ACTIONS, daemonVoiceTools } from '@ruimte/voice';
import type { CanvasHost } from '../canvas/verb.ts';
import { voiceActionCall, type VoiceActionContext, type ServerActionContext } from '../actions/context.ts';
import { serverActions } from '../actions/server-actions.ts';
import { VOICE_FIELD_RULES, voicePolicy } from './action-policy.ts';
import { VoiceToolExecutor } from './tool-executor.ts';

const PLACE = { projectId: 'project-1', folder: '/work/app', canvasId: 'main' };
const VOICE = { sessionId: 'session-1', owner: { clientId: 'client-1', sceneId: 'scene-1' }, projectId: 'project-1', timeZone: 'UTC' };

/*
 * Every action of the daemon's registry that the catalog opens to Voice, and the choice for it on the
 * daemon: `voice` runs it, `blocked` keeps it behind the policy. An action that is opened to Voice, or
 * gets a daemon handler, without a line here fails this test until someone chooses.
 */
const DAEMON_VOICE_REACH: Record<string, 'voice' | 'blocked'> = {
    'view.focus': 'blocked',
    'view.rename': 'blocked',
    'view.create': 'blocked',
    'view.delete': 'blocked',
    'node.rename': 'blocked',
    'node.setColor': 'blocked',
    'node.create': 'blocked',
    'node.delete': 'blocked',
    'group.create': 'blocked',
    'chat.fork': 'blocked',
    'view.setIcon': 'blocked',
    'node.update': 'blocked',
    'plan.list': 'blocked',
    'plan.read': 'blocked',
    'plan.setStepState': 'blocked',
    'plan.addNote': 'blocked',
    'diagram.replaceContent': 'blocked',
    'browser.inspect': 'blocked',
    'browser.navigate': 'blocked',
    'browser.back': 'blocked',
    'browser.forward': 'blocked',
    'browser.reload': 'blocked',
    'browser.stop': 'blocked',
    'operation.cancel': 'blocked',
    'worktree.list': 'blocked',
    'worktree.diff': 'blocked',
    'worktree.merge': 'blocked',
    'chat.read': 'voice',
    'agent.start': 'voice',
    'workspace.inspect': 'voice',
    'target.resolve': 'voice',
    'chat.inspect': 'voice',
    'agents.inspect': 'voice',
    'chat.send': 'voice',
    'chat.clear': 'voice',
    'project.list': 'voice',
    'project.switch': 'voice'
};

function voiceCall() {
    return voiceActionCall({} as CanvasHost, PLACE, VOICE);
}

describe('the daemon policy of Voice', () => {
    test('every action names its actors, so none is open to Voice by leaving it out', () => {
        for (const definition of Object.values(ACTION_DEFINITIONS)) {
            expect(definition.actors.length).toBeGreaterThan(0);
            expect(definition.actors.every((actor) => (ACTION_ACTOR_KINDS as readonly string[]).includes(actor))).toBe(true);
        }
    });

    test('what the registry opens to Voice on the daemon is chosen action by action', () => {
        const reached: string[] = serverActions.catalog(voiceCall()).map((capability) => capability.name);
        expect(Object.fromEntries(reached.map((name) => [name, DAEMON_VOICE_REACH[name] ?? 'unchosen']))).toEqual(DAEMON_VOICE_REACH);
        // A choice for Voice is a line in the matrix, and a line in the matrix is a choice for Voice.
        const chosen = Object.entries(DAEMON_VOICE_REACH)
            .filter(([, choice]) => choice === 'voice')
            .map(([name]) => name);
        const matrix = new Set(DAEMON_VOICE_ACTIONS.map((action) => action.name as string));
        expect(chosen.every((name) => matrix.has(name))).toBe(true);
        expect(reached.filter((name) => matrix.has(name)).sort()).toEqual([...chosen].sort());
    });

    test('lets through exactly the matrix', () => {
        const policy = voicePolicy();
        for (const name of Object.keys(ACTION_DEFINITIONS) as ActionName[]) {
            const action = DAEMON_VOICE_ACTIONS.find((candidate) => candidate.name === name);
            expect(policy.check(name, {}) === null).toBe(action !== undefined);
        }
        expect(policy.check('chat.send', { chatId: 'c', prompt: 'hi' })).toBeNull();
        expect(policy.check('view.delete', { viewId: 'v' })).toMatchObject({ code: 'not-for-voice' });
    });

    test('every action of the matrix has its rule for the fields', () => {
        expect(Object.keys(VOICE_FIELD_RULES).sort()).toEqual(DAEMON_VOICE_ACTIONS.map((action) => action.name as string).sort());
        for (const [name, rule] of Object.entries(VOICE_FIELD_RULES)) {
            const shape = Object.keys(ACTION_DEFINITIONS[name as ActionName].input.shape);
            for (const field of [...(rule.fields ?? []), ...(rule.off ?? [])]) {
                expect(shape).toContain(field);
            }
        }
    });

    test('refuses the fields of agent.start that are not Voice’s, whatever their value', () => {
        const policy = voicePolicy();
        const start = { provider: 'claude', terminal: false, worktree: false, prompt: 'Fix the tests', task: null, cwd: null };
        expect(policy.check('agent.start', start)).toBeNull();
        expect(policy.check('agent.start', { ...start, terminal: true })).toMatchObject({ code: 'voice-field' });
        expect(policy.check('agent.start', { ...start, worktree: true })).toMatchObject({ code: 'voice-field' });
        expect(policy.check('agent.start', { ...start, task: 'Tests' })).toMatchObject({ code: 'voice-field' });
        expect(policy.check('agent.start', { ...start, cwd: '/etc' })).toMatchObject({ code: 'voice-field' });
        expect(policy.check('agent.start', { ...start, machine: 'machine-b' })).toMatchObject({ code: 'voice-field' });
        expect(policy.check('chat.send', { chatId: 'c', prompt: 'hi', attachments: [{ name: 'x' }] })).toMatchObject({ code: 'voice-field' });
        expect(policy.check('chat.read', { chatId: 'c', limit: 5 })).toBeNull();
        expect(policy.check('chat.clear', { chatId: 'c', force: null })).toBeNull();
        expect(policy.check('chat.clear', { chatId: 'c', force: true })).toMatchObject({ code: 'voice-field' });
    });

    test('a call the registry would run for Voice never reaches it outside the matrix', async () => {
        let mutated = 0;
        const host = {
            projects: {
                locate: () => PLACE,
                machineOfNode: () => null,
                read: async () => ({ views: [{ id: 'v1', kind: 'canvas', name: 'Main', nodes: [], edges: [] }] }),
                revision: async () => 1,
                mutate: async () => {
                    mutated += 1;
                    return undefined;
                }
            }
        } as unknown as CanvasHost;
        const call = voiceActionCall(host, PLACE, VOICE);
        // Without the policy the registry runs it, which is the gap the policy closes.
        expect(serverActions.catalog(call).some((capability) => capability.name === 'view.rename')).toBe(true);
        const executor = new VoiceToolExecutor<ServerActionContext>({
            sessionId: VOICE.sessionId,
            runner: serverActions,
            policy: voicePolicy(),
            tools: voiceToolDefinitions(),
            call: (): { actor: typeof call.actor; context: VoiceActionContext } => call,
            live: () => true
        });
        const output = await executor.execute('manage_views', JSON.stringify({ action: 'view.rename', viewId: 'v1', name: 'Renamed' }), 'call-1');
        expect(output).toMatchObject({ ok: false, code: 'not-for-voice' });
        expect(mutated).toBe(0);
    });

    test('the tools of the daemon offer the matrix and nothing the registry would refuse', () => {
        const offered = daemonVoiceTools().flatMap((tool) => {
            if (tool.name === VOICE_CONTROL_TOOL) {
                return [];
            }
            const action = tool.parameters.properties.action as { enum?: string[] } | undefined;
            return action?.enum ?? [];
        });
        const policy = voicePolicy();
        expect(offered.every((name) => policy.check(name, {}) === null)).toBe(true);
    });
});
