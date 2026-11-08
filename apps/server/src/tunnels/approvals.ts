import { ToolRefusal } from '@adecore/agents/context';
import { isCanvasView, nodeChats, viewChats, type ProjectContent, type RuntimeMode } from '@ruimte/contracts';
import { z } from 'zod';
import { listed, type Tool } from '../mcp/catalog.ts';
import { scopedProjects } from '../tools/external-reach.ts';
import { field } from '../tools/host.ts';
import { modeRank } from '../tools/mode.ts';
import { defineTool, type ToolCall } from '../tools/tool.ts';

export type ApprovalKind = 'chat' | 'command' | 'launch' | 'routine' | 'mode';

/* One thing that waits for a person, in a project. */
export interface ApprovalItem {
    kind: ApprovalKind;
    projectId: string;
    /* The node or chat it belongs to, or the launch or routine. */
    subject: string;
    /* What identifies it within the subject: a request, a command, a digest. */
    key: string;
    text: string;
}

/* The services behind the approvals, so a test hands in fakes. Each answers as the person would from the app. */
export interface ApprovalPorts {
    content(projectId: string): Promise<ProjectContent>;
    folderOf(projectId: string): string | null;
    chatApprovals(chatId: string): Array<{ requestId: string; toolName: string; description: string | null }>;
    answerChat(chatId: string, requestId: string, decision: 'allow' | 'deny'): void;
    /* The terminals of this machine that hold a command a person has not approved. */
    heldCommands(): Array<{ sessionId: string; command: string }>;
    approveCommand(sessionId: string): Promise<void>;
    unapprovedLaunches(projectId: string): Promise<Array<{ launchId: string; name: string }>>;
    approveLaunch(projectId: string, launchId: string): Promise<void>;
    unapprovedRoutines(projectId: string): Promise<Array<{ routineId: string; name: string; digest: string }>>;
    answerRoutine(projectId: string, routineId: string, digest: string, approve: boolean): Promise<void>;
    approvedMode(folder: string, nodeId: string): RuntimeMode | null;
    approveMode(folder: string, nodeId: string, mode: RuntimeMode): Promise<void>;
}

/* The chats of a project, wherever they stand: on a canvas, as a view of their own, or inside a design. */
function chatIdsOf(content: ProjectContent): Array<{ id: string; name: string }> {
    return content.views.flatMap((view) =>
        [...viewChats(view), ...(isCanvasView(view) ? view.nodes.flatMap(nodeChats) : [])].map((chat) => ({ id: chat.id, name: chat.name }))
    );
}

/* The terminal agents whose saved mode a person has not approved yet. */
function modeNodes(content: ProjectContent): Array<{ id: string; mode: RuntimeMode }> {
    return content.views.flatMap((view) => {
        const terminals = isCanvasView(view)
            ? view.nodes.filter((node) => node.kind === 'terminal')
            : view.kind === 'terminal'
              ? [{ ...view.node, id: view.id }]
              : [];

        return terminals.flatMap((node) => (node.provider && node.runtimeMode ? [{ id: node.id, mode: node.runtimeMode }] : []));
    });
}

export async function pendingApprovals(ports: ApprovalPorts, projectId: string): Promise<ApprovalItem[]> {
    const content = await ports.content(projectId);
    const folder = ports.folderOf(projectId);
    const items: ApprovalItem[] = [];

    for (const chat of chatIdsOf(content)) {
        for (const request of ports.chatApprovals(chat.id)) {
            items.push({
                kind: 'chat',
                projectId,
                subject: chat.id,
                key: request.requestId,
                text: `${chat.name} asks to use ${request.toolName}${request.description === null ? '' : `: ${request.description}`}`
            });
        }
    }

    const terminals = new Set(
        content.views.flatMap((view) =>
            isCanvasView(view) ? view.nodes.filter((node) => node.kind === 'terminal').map((node) => node.id) : view.kind === 'terminal' ? [view.id] : []
        )
    );

    for (const held of ports.heldCommands()) {
        if (terminals.has(held.sessionId)) {
            items.push({ kind: 'command', projectId, subject: held.sessionId, key: held.sessionId, text: `A terminal holds the command ${held.command}` });
        }
    }

    for (const launch of await ports.unapprovedLaunches(projectId)) {
        items.push({ kind: 'launch', projectId, subject: launch.launchId, key: launch.launchId, text: `The launch ${launch.name} waits for approval` });
    }

    for (const routine of await ports.unapprovedRoutines(projectId)) {
        items.push({ kind: 'routine', projectId, subject: routine.routineId, key: routine.digest, text: `The routine ${routine.name} waits for approval` });
    }

    if (folder !== null) {
        for (const node of modeNodes(content)) {
            if (ports.approvedMode(folder, node.id) !== node.mode) {
                items.push({ kind: 'mode', projectId, subject: node.id, key: node.mode, text: `A terminal agent is saved to run in ${node.mode}` });
            }
        }
    }

    return items;
}

/* The id a tool prints for an approval and takes back: opaque, and every part checked again when it is used. */
function idOf(item: ApprovalItem): string {
    return [item.kind, item.projectId, item.subject, item.key].map(encodeURIComponent).join('~');
}

function itemOf(id: string): ApprovalItem | null {
    const parts = id.split('~').map(decodeURIComponent);

    return parts.length === 4 && ['chat', 'command', 'launch', 'routine', 'mode'].includes(parts[0]!)
        ? { kind: parts[0] as ApprovalKind, projectId: parts[1]!, subject: parts[2]!, key: parts[3]!, text: '' }
        : null;
}

function externalOf(call: ToolCall): NonNullable<ToolCall['external']> {
    if (call.external === undefined) {
        throw new ToolRefusal('not-external', 'This tool is for a client elsewhere');
    }

    return call.external;
}

/*
 * The two tools the box on a credential adds. With the box off they do not exist for it. With it on, the client answers as the
 * person would: a chat's runtime approval, a command a terminal holds, a launch, a routine, or the mode of a terminal agent,
 * the last never wider than the ceiling on the credential. It never types into a terminal, and it answers nothing outside its scope.
 */
export function approvalTools(ports: ApprovalPorts): Tool[] {
    const list = defineTool('approval', {
        name: 'approval_list',
        description: 'Lists what waits for a person to approve in the projects this credential reaches.',
        annotations: { readOnly: true },
        input: z.object({}),
        async run(_input, call) {
            const projects = await scopedProjects(call.host, externalOf(call).grant);
            const items = (await Promise.all(projects.open.map((project) => pendingApprovals(ports, project.projectId)))).flat();

            return items.length === 0
                ? ['note\tNothing waits for approval']
                : items.map((item) => `approval\t${idOf(item)}\t${item.kind}\t${item.projectId}\t${field(item.text)}`);
        }
    });

    const answer = defineTool('approval', {
        name: 'approval_answer',
        description: 'Approves or declines one thing approval_list names, as the person would.',
        input: z.object({
            id: z.string({ error: 'approval_answer needs id, from approval_list' }).min(1, 'approval_answer needs id, from approval_list'),
            decision: z.enum(['allow', 'deny']).optional().describe('allow when left out; only a chat request and a routine can be denied')
        }),
        async run(input, call) {
            const external = externalOf(call);
            const wanted = itemOf(input.id);
            const projects = await scopedProjects(call.host, external.grant);
            const known = wanted === null ? null : projects.open.find((project) => project.projectId === wanted.projectId);

            if (wanted === null || known === undefined || known === null) {
                throw new ToolRefusal('unknown-approval', `${input.id} is nothing this credential may approve; approval_list lists what it may`);
            }

            // Only what still waits: an id from a list is checked against the list again.
            const waiting = (await pendingApprovals(ports, wanted.projectId)).find((item) => idOf(item) === input.id);

            if (waiting === undefined) {
                throw new ToolRefusal('not-waiting', `${input.id} no longer waits for approval; approval_list shows what does`);
            }

            const allow = (input.decision ?? 'allow') === 'allow';

            switch (waiting.kind) {
                case 'chat':
                    ports.answerChat(waiting.subject, waiting.key, allow ? 'allow' : 'deny');
                    break;
                case 'routine': {
                    await ports.answerRoutine(waiting.projectId, waiting.subject, waiting.key, allow);
                    break;
                }
                case 'command':
                case 'launch':
                case 'mode': {
                    if (!allow) {
                        throw new ToolRefusal('cannot-deny', `A ${waiting.kind} is only approved here; leave it waiting for the person to decline`);
                    }

                    if (waiting.kind === 'command') {
                        await ports.approveCommand(waiting.subject);
                    } else if (waiting.kind === 'launch') {
                        await ports.approveLaunch(waiting.projectId, waiting.subject);
                    } else {
                        const folder = ports.folderOf(waiting.projectId);
                        const mode = waiting.key as RuntimeMode;

                        if (folder === null) {
                            throw new ToolRefusal('unknown-approval', `${input.id} is in no project folder on this machine`);
                        }

                        if (modeRank(mode) > modeRank(external.grant.ceiling)) {
                            throw new ToolRefusal(
                                'mode-above-ceiling',
                                `${waiting.subject} is saved to run in ${mode}, wider than the ${external.grant.ceiling} this credential may approve`
                            );
                        }

                        await ports.approveMode(folder, waiting.subject, mode);
                    }

                    break;
                }
            }

            return [`${allow ? 'approved' : 'declined'}\t${input.id}\t${waiting.kind}`];
        }
    });

    return [listed(list), listed(answer)];
}
