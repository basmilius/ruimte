import { describe, expect, test } from 'bun:test';
import type { ExternalGrant, ProjectContent, RuntimeMode } from '@ruimte/contracts';
import { externalActorId, type ExternalCaller } from '../mcp/caller.ts';
import { visibleExternalTools } from '../mcp/external-catalog.ts';
import { callExternalTool } from '../mcp/external-route.ts';
import type { CanvasHost } from '../tools/host.ts';
import { approvalTools, type ApprovalPorts } from './approvals.ts';

const content = {
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [
                { id: 'chat-1', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                { id: 'term-1', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360, provider: 'claude', runtimeMode: 'full-access' }
            ],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
} as unknown as ProjectContent;

const host = {
    reach: {
        enabled: () => false,
        open: async () => [
            { projectId: 'p1', name: 'repo', folder: '/nowhere/repo' },
            { projectId: 'p2', name: 'other', folder: '/nowhere/other' }
        ],
        recent: async () => []
    }
} as unknown as CanvasHost;

interface Calls {
    chat: string[];
    commands: string[];
    launches: string[];
    routines: string[];
    modes: string[];
}

function ports(): { ports: ApprovalPorts; calls: Calls } {
    const calls: Calls = { chat: [], commands: [], launches: [], routines: [], modes: [] };
    const modes = new Map<string, RuntimeMode>();

    return {
        calls,
        ports: {
            content: async () => content,
            folderOf: (projectId) => `/nowhere/${projectId}`,
            chatApprovals: (chatId) => (chatId === 'chat-1' ? [{ requestId: 'req-1', toolName: 'Bash', description: 'rm -rf build' }] : []),
            answerChat: (chatId, requestId, decision) => {
                calls.chat.push(`${chatId}/${requestId}/${decision}`);
            },
            heldCommands: () => [{ sessionId: 'term-1', command: 'npm run dev' }],
            approveCommand: async (sessionId) => {
                calls.commands.push(sessionId);
            },
            unapprovedLaunches: async () => [{ launchId: 'serve', name: 'Dev server' }],
            approveLaunch: async (projectId, launchId) => {
                calls.launches.push(`${projectId}/${launchId}`);
            },
            unapprovedRoutines: async () => [{ routineId: 'morning', name: 'Morning', digest: 'abc' }],
            answerRoutine: async (projectId, routineId, digest, approve) => {
                calls.routines.push(`${projectId}/${routineId}/${digest}/${approve}`);
            },
            approvedMode: (_folder, nodeId) => modes.get(nodeId) ?? null,
            approveMode: async (_folder, nodeId, mode) => {
                calls.modes.push(`${nodeId}/${mode}`);
                modes.set(nodeId, mode);
            }
        }
    };
}

function caller(rest: Partial<ExternalGrant> = {}): ExternalCaller {
    return {
        kind: 'external',
        id: externalActorId('cred-1'),
        credentialId: 'cred-1',
        label: 'Hosted bot',
        grant: { tier: 'work', projects: null, ceiling: 'supervised', approvals: true, ...rest }
    };
}

async function run(
    who: ExternalCaller,
    name: string,
    input: Record<string, unknown>,
    given = ports()
): Promise<{ text: string; refused: boolean; calls: Calls }> {
    const extraTools = approvalTools(given.ports);
    const result = await callExternalTool(visibleExternalTools(who, host, extraTools), who, name, input, { host, extraTools });

    return { text: result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n'), refused: result.isError === true, calls: given.calls };
}

function idOf(text: string, kind: string, project = 'p1'): string {
    return text
        .split('\n')
        .map((line) => line.split('\t'))
        .find((parts) => parts[2] === kind && parts[3] === project)![1]!;
}

describe('with the box off', () => {
    test('the approval tools do not exist for the credential', async () => {
        const who = caller({ approvals: false });
        const names = visibleExternalTools(who, host, approvalTools(ports().ports)).map((tool) => tool.name);

        expect(names).not.toContain('approval_list');
        expect(names).not.toContain('approval_answer');

        for (const name of ['approval_list', 'approval_answer']) {
            const answer = await run(who, name, { id: 'x' });

            expect(answer.refused).toBe(true);
            expect(answer.text).toContain('refused unknown-tool');
        }
    });
});

describe('with the box on', () => {
    test('lists a chat request, a held command, a launch, a routine and a mode in the projects it reaches', async () => {
        const { text } = await run(caller(), 'approval_list', {});

        for (const kind of ['chat', 'command', 'launch', 'routine', 'mode']) {
            expect(text).toContain(`\t${kind}\tp1\t`);
        }
    });

    test('lists only the projects of its scope', async () => {
        const { text } = await run(caller({ projects: ['p2'] }), 'approval_list', {});

        expect(text).not.toContain('\tp1\t');
        expect(text).toContain('\tp2\t');
    });

    test('answers a chat request as the person would', async () => {
        const given = ports();
        const list = await run(caller(), 'approval_list', {}, given);
        const answer = await run(caller(), 'approval_answer', { id: idOf(list.text, 'chat'), decision: 'deny' }, given);

        expect(answer.refused).toBe(false);
        expect(given.calls.chat).toEqual(['chat-1/req-1/deny']);
    });

    test('approves a held command, a launch and a routine', async () => {
        const given = ports();
        const list = await run(caller(), 'approval_list', {}, given);

        for (const kind of ['command', 'launch', 'routine']) {
            expect((await run(caller(), 'approval_answer', { id: idOf(list.text, kind) }, given)).refused).toBe(false);
        }

        expect(given.calls.commands).toEqual(['term-1']);
        expect(given.calls.launches).toEqual(['p1/serve']);
        expect(given.calls.routines).toEqual(['p1/morning/abc/true']);
    });

    test('declines a routine, and refuses to decline a command', async () => {
        const given = ports();
        const list = await run(caller(), 'approval_list', {}, given);

        expect((await run(caller(), 'approval_answer', { id: idOf(list.text, 'routine'), decision: 'deny' }, given)).refused).toBe(false);
        expect(given.calls.routines).toEqual(['p1/morning/abc/false']);
        expect((await run(caller(), 'approval_answer', { id: idOf(list.text, 'command'), decision: 'deny' }, given)).text).toContain('refused cannot-deny');
    });

    test('refuses a mode above the ceiling, and approves one within it', async () => {
        const given = ports();
        const list = await run(caller({ ceiling: 'supervised' }), 'approval_list', {}, given);
        const id = idOf(list.text, 'mode');
        const refused = await run(caller({ ceiling: 'supervised' }), 'approval_answer', { id }, given);

        expect(refused.text).toContain('refused mode-above-ceiling');
        expect(given.calls.modes).toEqual([]);

        const accepted = await run(caller({ ceiling: 'full-access' }), 'approval_answer', { id }, given);

        expect(accepted.refused).toBe(false);
        expect(given.calls.modes).toEqual(['term-1/full-access']);
    });

    test('answers nothing outside its scope, nothing that is made up and nothing that no longer waits', async () => {
        const given = ports();
        const list = await run(caller(), 'approval_list', {}, given);
        const id = idOf(list.text, 'launch');

        expect((await run(caller({ projects: ['p2'] }), 'approval_answer', { id }, given)).text).toContain('refused unknown-approval');
        expect((await run(caller(), 'approval_answer', { id: 'launch~p1~nope~nope' }, given)).text).toContain('refused not-waiting');
        expect((await run(caller(), 'approval_answer', { id: 'garbage' }, given)).text).toContain('refused unknown-approval');
        expect(given.calls.launches).toEqual([]);
    });
});
