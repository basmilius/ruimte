import type { ActionHandlers } from '@ruimte/actions';
import {
    chatNameOf,
    isAgentKind,
    isCanvasView,
    nodeChats,
    viewChats,
    type CanvasNodeKind,
    type ChatApprovalItem,
    type ChatQuestionItem,
    type ProjectView
} from '@ruimte/contracts';
import { refuseOtherMachine } from '../canvas/remote-node.ts';
import { VerbRefusal, field, orNote, type ChatRequestHost } from '../canvas/verb.ts';
import { hostService, type ServerActionContext } from './context.ts';

/* One row per request an agent waits on, which is what a refusal of `answer` offers instead. */
function requestLine(nodeId: string, item: ChatQuestionItem | ChatApprovalItem): string {
    return item.kind === 'question'
        ? `question\t${nodeId}\t${item.requestId}\t${item.questions.map((question) => `${question.id}: ${field(question.question)}`).join(' | ')}`
        : `approval\t${nodeId}\t${item.requestId}\t${field(item.toolName)}\ta person's alone`;
}

/* The caller's name as a message signs it: any chat by its own name, a later one of a design too, else its node on a canvas or the view it is. */
function callerTitle(views: readonly ProjectView[], caller: string): string {
    const chatName = chatNameOf(views, caller);
    if (chatName !== null) {
        return chatName;
    }
    for (const view of views) {
        if (view.id === caller) {
            return view.name ?? '';
        }
        const node = isCanvasView(view) ? view.nodes.find((candidate) => candidate.id === caller) : undefined;
        if (node) {
            return node.title;
        }
    }
    return '';
}

/* What a message to this id would reach: an agent, the kind of a node that has none, or null where the project has no such id. */
function messageTarget(views: readonly ProjectView[], id: string): 'agent' | CanvasNodeKind | null {
    for (const view of views) {
        if (view.id === id && view.kind === 'terminal') {
            return 'agent';
        }
        if (viewChats(view).some((chat) => chat.id === id)) {
            return 'agent';
        }
        const node = isCanvasView(view)
            ? view.nodes.find((candidate) => candidate.id === id || nodeChats(candidate).some((chat) => chat.id === id))
            : undefined;
        if (node) {
            return isAgentKind(node.kind) ? 'agent' : node.kind;
        }
    }

    return null;
}

function waitingLines(requests: ChatRequestHost, nodeId: string): string[] {
    return orNote(
        requests.waiting(nodeId).map((item) => requestLine(nodeId, item)),
        `${nodeId} waits on no question now`
    );
}

/* The answers keyed by question id, from the one answer or the map a call gave, refused while one is missing. */
function answersFor(item: ChatQuestionItem, answer: string | null, answers: Record<string, string> | null): Record<string, string> {
    const ids = item.questions.map((question) => question.id);
    if (answer !== null && answers !== null) {
        throw new VerbRefusal('answer-twice', '--answer and --answers both carry the answer; give one of them');
    }
    if (answer !== null) {
        if (ids.length !== 1) {
            throw new VerbRefusal('answers-needed', `This request asks ${ids.length} questions; give --answers with one answer per question id`, [
                `note\t--answers '${JSON.stringify(Object.fromEntries(ids.map((id) => [id, '...'])))}'`
            ]);
        }
        answers = { [ids[0]!]: answer };
    }
    const given = Object.fromEntries(Object.entries(answers ?? {}).map(([id, text]) => [id, text.trim()]));
    const unknown = Object.keys(given).filter((id) => !ids.includes(id));
    if (unknown.length > 0) {
        throw new VerbRefusal('unknown-question', `${unknown.join(', ')} is not a question of this request; its ids are ${ids.join(', ')}`);
    }
    const missing = ids.filter((id) => (given[id] ?? '') === '');
    if (missing.length > 0) {
        throw new VerbRefusal(
            'empty-answer',
            ids.length === 1
                ? 'The answer is empty; give it with --answer'
                : `Question ${missing.join(', ')} has no answer; every question of the request needs one`
        );
    }
    return given;
}

export const agentActions: ActionHandlers<ServerActionContext> = {
    'agent.answer': async ({ nodeId, requestId, answer, answers }, { actor, context }) => {
        const { host } = context;
        const caller = actor.id;
        if (nodeId === caller) {
            throw new VerbRefusal('self-answer', `${nodeId} is you; answer is for a question an agent you opened asks`);
        }
        /* Only an agent the caller opened, as the daemon wrote it down: a line would let two agents answer
           for each other, and an empty chat made with node new is a person's to use. */
        if ((host.agents?.startedBy(nodeId) ?? null) !== caller) {
            throw new VerbRefusal('not-yours', `${nodeId} is not a node you opened; you only answer the questions of an agent you opened yourself`);
        }
        const requests = hostService(context, 'requests', 'no-agent', `${nodeId} runs no chat on this machine that could ask anything`);
        const item = requests.request(nodeId, requestId);
        if (item === null) {
            throw new VerbRefusal('unknown-request', `${nodeId} asked nothing under ${requestId}`, waitingLines(requests, nodeId));
        }
        if (item.kind === 'approval') {
            throw new VerbRefusal(
                'not-a-question',
                `${requestId} asks a person to approve ${field(item.toolName)}; an approval is a person's alone, so tell the person if it holds up your plan`,
                waitingLines(requests, nodeId)
            );
        }
        if (item.state !== 'pending') {
            throw new VerbRefusal('not-pending', `${requestId} no longer waits: it was ${item.state}`, waitingLines(requests, nodeId));
        }
        // The same door a person's chat.answer goes through, so whoever answers second is refused there.
        if (!requests.answer(nodeId, requestId, answersFor(item, answer, answers))) {
            throw new VerbRefusal('not-pending', `${requestId} no longer waits: it was answered a moment ago`, waitingLines(requests, nodeId));
        }
        return { output: { nodeId, requestId } };
    },
    'agent.alert': async ({ text }, { actor, context }) => {
        // Reading the place refuses a caller no project places.
        void context.place;
        context.host.messages.alert(actor.id, text);
        return { output: { nodeId: actor.id } };
    },
    'agent.notify': async ({ nodeId, text }, { actor, context }) => {
        const { host, place } = context;
        const caller = actor.id;
        if (nodeId === caller) {
            throw new VerbRefusal('self-notify', `${nodeId} is you; a node needs no message to itself`);
        }

        /* A message reaches every terminal and chat of the caller's project, on any canvas or a view of
           its own, with no line: the one step a message wakes and no further, decided in `deliverNotice`,
           is what keeps two agents from waking each other on and on. */
        const content = await host.projects.read(place.projectId);
        const target = messageTarget(content.views, nodeId);
        if (target === null) {
            throw new VerbRefusal('unknown-node', `${nodeId} is no terminal or chat of this project`, [
                'see\truimte-context node list\tlists the nodes of a canvas with their ids',
                'see\truimte-context view list\tlists the views of this project, a terminal or chat of its own among them'
            ]);
        }
        if (target !== 'agent') {
            throw new VerbRefusal('not-an-agent', `${nodeId} is a ${target} node; only a terminal or a chat has an agent that could read a message`);
        }
        refuseOtherMachine(host, nodeId);

        const delivery = await host.messages.notify({
            projectId: place.projectId,
            targetId: nodeId,
            from: caller,
            fromTitle: field(callerTitle(content.views, caller)),
            text
        });

        return { output: { nodeId, at: delivery.at, detail: delivery.detail } };
    }
};
