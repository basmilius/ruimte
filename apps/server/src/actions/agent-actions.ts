import { ToolRefusal } from '@adecore/agents/context';
import { answerQuestion } from '@adecore/agents/coordination';
import type { ActionHandlers } from '@ruimte/actions';
import { chatNameOf, isAgentKind, isCanvasView, nodeChats, viewChats, type CanvasNodeKind, type ProjectView } from '@ruimte/contracts';
import { externalActorTitle } from '../canvas/external-caller.ts';
import { field } from '../canvas/host.ts';
import { refuseOtherMachine } from '../canvas/remote-node.ts';
import { hostService, type ServerActionContext } from './context.ts';

/* The caller's name as a message signs it: any chat by its own name, a later one of a design too, else its node on a canvas or the view it is. */
function titleOf(views: readonly ProjectView[], caller: string): string {
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

export const agentActions: ActionHandlers<ServerActionContext> = {
    'agent.answer': async ({ nodeId, requestId, answer, answers }, { actor, context }) => {
        const { host } = context;
        const caller = actor.id;
        if (nodeId === caller) {
            throw new ToolRefusal('self-answer', `${nodeId} is you; answer is for a question an agent you opened asks`);
        }
        /* Only an agent the caller opened, as the daemon wrote it down: a line would let two agents answer
           for each other, and an empty chat made with node new is a person's to use. */
        if ((host.agents?.startedBy(nodeId) ?? null) !== caller) {
            throw new ToolRefusal('not-yours', `${nodeId} is not a node you opened; you only answer the questions of an agent you opened yourself`);
        }
        const requests = hostService(context, 'requests', 'no-agent', `${nodeId} runs no chat on this machine that could ask anything`);
        answerQuestion(requests, nodeId, requestId, { answer, answers });
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
            throw new ToolRefusal('self-notify', `${nodeId} is you; a node needs no message to itself`);
        }

        /* A message reaches every terminal and chat of the caller's project, on any canvas or a view of
           its own, with no line: the one step a message wakes and no further, decided in `deliverNotice`,
           is what keeps two agents from waking each other on and on. */
        const content = await host.projects.read(place.projectId);
        const target = messageTarget(content.views, nodeId);
        if (target === null) {
            throw new ToolRefusal('unknown-node', `${nodeId} is no terminal or chat of this project`, [
                'see\tnode_list\tlists the nodes of a canvas with their ids',
                'see\tview_list\tlists the views of this project, a terminal or chat of its own among them'
            ]);
        }
        if (target !== 'agent') {
            throw new ToolRefusal('not-an-agent', `${nodeId} is a ${target} node; only a terminal or a chat has an agent that could read a message`);
        }
        refuseOtherMachine(host, nodeId);

        // A caller in another project, which `project` reached this one from, is named with its project, so the answer knows where to go.
        const own = context.origin === undefined ? null : await host.projects.read(context.origin.projectId);
        const fromTitle =
            context.external !== undefined
                ? externalActorTitle(context.external)
                : own === null
                  ? titleOf(content.views, caller)
                  : `${titleOf(own.views, caller)} in ${own.name}`;

        const delivery = await host.messages.notify({
            projectId: place.projectId,
            targetId: nodeId,
            from: caller,
            fromTitle: field(fromTitle),
            text
        });

        const title = titleOf(content.views, nodeId).replace(/\s+/g, ' ').trim();

        return { output: { nodeId, at: delivery.at, detail: delivery.detail, ...(title === '' ? {} : { title }) } };
    }
};
