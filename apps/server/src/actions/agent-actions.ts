import type { ActionHandlers } from '@ruimte/actions';
import { isAgentKind } from '@ruimte/contracts';
import { refuseMissingNodes } from '../canvas/own-view.ts';
import { VerbRefusal, canvasFor, field, orNote } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

export const agentActions: ActionHandlers<ServerActionContext> = {
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
