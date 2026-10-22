import { useEffect, useState } from 'react';
import { canvasPrompts, samePrompts, type CanvasPrompt } from '@/canvas/prompts';
import { useCanvasStore } from '@/state/canvas';
import { useChats } from '@adecore/agents-react/state';
import { subscribeChatThreads } from '@/state/chats';
import { computerApprovalsOf, useComputer } from '@/state/computer';
import { endpointOfNode, useEndpointId } from '@/state/keys';
import { proposalsOf, useProposals } from '@/state/proposals';
import { secretRequestsOf, useSecrets } from '@/state/secrets';
import { useSessions } from '@/state/sessions';
import { useWaitingSince } from '@/state/waiting';

const NONE: CanvasPrompt[] = [];

/*
 * The prompts of the canvas in this cell. It subscribes rather than selecting: every streamed word
 * changes the chats store, and the stack should only hear about a prompt that came or went.
 */
export function useCanvasPrompts(): CanvasPrompt[] {
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    const [prompts, setPrompts] = useState<CanvasPrompt[]>(NONE);

    useEffect(() => {
        const update = (): void => {
            const nodes = Object.values(canvasStore.getState().nodes);
            // The cards of every machine a node on this canvas runs on: a card belongs to the node that asks, wherever that runs.
            const machines = [...new Set([endpointId, ...nodes.map((node) => endpointOfNode(node, endpointId))])];
            const next = canvasPrompts({
                nodes,
                endpointId,
                sessions: useSessions.getState().byKey,
                chats: useChats.getState().byKey,
                computer: machines.flatMap(computerApprovalsOf),
                secrets: machines.flatMap(secretRequestsOf),
                proposals: machines.flatMap(proposalsOf),
                waitingSince: useWaitingSince.getState().byKey
            });
            setPrompts((current) => (samePrompts(current, next.prompts) ? current : next.prompts));
        };
        update();
        const unsubscribe = [
            canvasStore.subscribe(update),
            subscribeChatThreads(update),
            useSessions.subscribe(update),
            useComputer.subscribe(update),
            useSecrets.subscribe(update),
            useProposals.subscribe(update)
        ];
        return () => {
            for (const off of unsubscribe) {
                off();
            }
        };
    }, [canvasStore, endpointId]);

    return prompts;
}
