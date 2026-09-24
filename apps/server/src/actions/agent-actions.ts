import type { ActionHandlers } from '@ruimte/actions';
import { isAgentKind, type ChatApprovalItem, type ChatQuestionItem } from '@ruimte/contracts';
import { refuseMissingNodes } from '../canvas/own-view.ts';
import { VerbRefusal, canvasFor, field, orNote, type ChatRequestHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

/* One row per request an agent waits on, which is what a refusal of `answer` offers instead. */
const requestLine = (nodeId: string, item: ChatQuestionItem | ChatApprovalItem): string =>
    item.kind === 'question'
        ? `question\t${nodeId}\t${item.requestId}\t${item.questions.map((question) => `${question.id}: ${field(question.question)}`).join(' | ')}`
        : `approval\t${nodeId}\t${item.requestId}\t${field(item.toolName)}\ta person's alone`;

const waitingLines = (requests: ChatRequestHost, nodeId: string): string[] =>
    orNote(
        requests.waiting(nodeId).map((item) => requestLine(nodeId, item)),
        `${nodeId} waits on no question now`
    );

/* The answers keyed by question id, from the one answer or the map a call gave, refused while one is missing. */
const answersFor = (item: ChatQuestionItem, answer: string | null, answers: Record<string, string> | null): Record<string, string> => {
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
};

export const agentActions: ActionHandlers<ServerActionContext> = {
    'agent.answer': async ({ nodeId, requestId, answer, answers }, { actor, context }) => {
        const { host } = context;
        const caller = actor.id;
        if (nodeId === caller) {
            throw new VerbRefusal('self-answer', `${nodeId} is you; answer is for a question an agent you opened asks`);
        }
        // Only an agent the caller opened, as the daemon wrote it down: a line would let two agents answer for each other.
        if (host.madeBy(nodeId) !== caller) {
            throw new VerbRefusal('not-yours', `${nodeId} is not a node you opened; you only answer the questions of an agent you opened yourself`);
        }
        const requests = host.requests;
        if (!requests) {
            throw new VerbRefusal('no-agent', `${nodeId} runs no chat on this machine that could ask anything`);
        }
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
    'agent.notify': async ({ nodeId, text }, { actor, context }) => {
        const { host, place } = context;
        const caller = actor.id;
        if (nodeId === caller) {
            throw new VerbRefusal('self-notify', `${nodeId} is you; a node needs no message to itself`);
        }
        if (place.canvasId === null) {
            throw new VerbRefusal('not-on-a-canvas', 'A message travels along a line between two nodes of one canvas, and this view has none', [
                'see\truimte-context link new\ta line needs both of its ends on one canvas'
            ]);
        }
        const content = await host.read(place.projectId);
        const canvas = canvasFor(content, place, undefined);
        /*
         * The rule is the one the canvas already draws: a line from the caller into an agent node is
         * what `deriveContextSources` turns into readable context, so a message may travel exactly
         * where a read already can. An agent cannot poke a node it has no relationship with, and the
         * person who drew the line can see who may reach whom.
         */
        const reachable = canvas.nodes.filter((node) => isAgentKind(node.kind) && canvas.edges.some((edge) => edge.from === caller && edge.to === node.id));
        const target = canvas.nodes.find((node) => node.id === nodeId);
        /* Only the nodes this same call would accept, and where there are none, what to do about
           the node that was asked for rather than a sentence about the canvas in general. */
        const lines = (): string[] =>
            orNote(
                reachable.map((node) => `node\t${node.id}\t${node.kind}\t${field(node.title)}`),
                `Nothing on ${canvas.id} has a line from you into it yet; ruimte-context link new --to ${nodeId} draws the one this call needs`
            );
        if (!target) {
            throw refuseMissingNodes(content, [nodeId], canvas.id, 'no line can run from you into it, and that is what a message travels along', lines());
        }
        if (!isAgentKind(target.kind)) {
            throw new VerbRefusal(
                'not-an-agent',
                `${nodeId} is a ${target.kind} node; only a terminal or a chat has an agent that could read a message`,
                lines()
            );
        }
        if (!reachable.some((node) => node.id === nodeId)) {
            throw new VerbRefusal(
                'not-linked',
                `${nodeId} is a ${target.kind} node on ${canvas.id}, but no line runs from you into it: draw that line and it can be notified`,
                [...lines(), `see\truimte-context link new --to ${nodeId}\tdraws the line this needs`]
            );
        }

        const self = canvas.nodes.find((node) => node.id === caller);
        // Delivered, waiting, and the one step a message wakes and no further are decided in `deliverNotice`.
        const delivery = await host.notify({
            projectId: place.projectId,
            targetId: nodeId,
            from: caller,
            fromTitle: field(self?.title ?? ''),
            text
        });
        return { output: { nodeId, at: delivery.at, detail: delivery.detail } };
    }
};
