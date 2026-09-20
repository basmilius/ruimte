import { afterEach, describe, expect, test } from 'bun:test';
import { ActionRegistry } from '@ruimte/actions';
import type { ChatInfo, ProjectSummary, SessionInfo } from '@ruimte/contracts';
import { inspectionActions } from './inspection-actions';
import { useDocument } from '@/state/document';
import { useProjectList } from '@/state/project-list';
import type { Transport } from '@/transport/transport';

const call = { actor: { kind: 'voice' as const, id: 'test' }, context: undefined };
const project: ProjectSummary = {
    projectId: 'flux',
    name: 'Flux',
    color: '#000',
    folder: null,
    lastOpenedAt: 1,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'F' },
    nameSource: 'chosen'
};

afterEach(() => {
    useProjectList.setState({ projects: [] });
    useDocument.getState().load(null, null);
});

describe('voice inspection actions', () => {
    test('switches using the machine and project identity and only reports verified success', async () => {
        useProjectList.setState({ projects: [{ endpointId: 'remote', summary: project }] });
        const calls: string[][] = [];
        const actions = new ActionRegistry(
            inspectionActions(useDocument, {
                switchProject: async (endpoint, id) => {
                    calls.push([endpoint, id]);
                    return 'done';
                }
            })
        );
        const result = await actions.execute('project.switch', { endpointId: 'remote', projectId: 'flux' }, call);
        expect(calls).toEqual([['remote', 'flux']]);
        expect(result).toMatchObject({ status: 'completed', output: { project: 'Flux', endpointId: 'remote', projectId: 'flux' } });
    });

    test.each(['failed', 'cancelled', 'replaced'] as const)('a %s switch is not reported as success', async (outcome) => {
        useProjectList.setState({ projects: [{ endpointId: 'remote', summary: project }] });
        const actions = new ActionRegistry(inspectionActions(useDocument, { switchProject: async () => outcome }));
        expect(await actions.execute('project.switch', { endpointId: 'remote', projectId: 'flux' }, call)).toMatchObject({
            status: 'failed',
            error: { code: 'project-switch-failed' }
        });
    });

    test('closed projects are refused before invoking the switcher', async () => {
        useProjectList.setState({ projects: [{ endpointId: 'remote', summary: { ...project, closedAt: 1 } }] });
        let invoked = false;
        const actions = new ActionRegistry(
            inspectionActions(useDocument, {
                switchProject: async () => {
                    invoked = true;
                    return 'done';
                }
            })
        );
        expect((await actions.execute('project.switch', { endpointId: 'remote', projectId: 'flux' }, call)).status).toBe('failed');
        expect(invoked).toBe(false);
    });

    test('reads fresh statuses, excludes plain shells and does not call a stale agent busy', async () => {
        useDocument.getState().load(
            {
                version: 3,
                rev: 0,
                name: 'Test',
                color: '#000',
                views: [
                    { id: 'chat', name: 'Research', kind: 'chat', node: {} },
                    { id: 'terminal', name: 'Coder', kind: 'terminal', node: {} },
                    { id: 'plain', name: 'Shell', kind: 'terminal', node: {} }
                ]
            },
            null
        );
        const chats = [{ chatId: 'chat', status: 'needs-you' }] as ChatInfo[];
        const sessions = [
            { sessionId: 'terminal', agent: { kind: 'codex', live: false, status: 'running', updatedAt: 1 } },
            { sessionId: 'plain', agent: null }
        ] as SessionInfo[];
        const transport: Transport = {
            status: 'open',
            request: (async (type: string) => (type === 'chat.list' ? { chats } : { sessions })) as Transport['request'],
            on: () => () => {},
            subscribeStatus: () => () => {}
        };
        const actions = new ActionRegistry(inspectionActions(useDocument, { transport: () => transport }));
        const result = await actions.execute('agents.inspect', {}, call);
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                connected: true,
                agents: [
                    { id: 'chat', status: 'needs-you', working: false },
                    { id: 'terminal', status: 'unknown', working: null }
                ]
            }
        });
    });
});
