import { useEffect, useState } from 'react';
import { nodeChats } from '@ruimte/contracts';
import { canvasPrompts, samePrompts, type CanvasPrompt } from '@/canvas/prompts';
import { useCanvasStore } from '@/state/canvas';
import { ChatPromptFeed } from '@adecore/agents-react/chat';
import type { PromptSubject } from '@adecore/agents-react/prompts';
import { chatScopeOf } from '@/transport/chat-scope';
import { useChats } from '@adecore/agents-react/state';
import { subscribeChatThreads } from '@/state/chats';
import { computerApprovalsOf, useComputer } from '@/state/computer';
import { endpointKey, endpointOfNode, useEndpointId } from '@/state/keys';
import { proposalsOf, useProposals } from '@/state/proposals';
import { secretRequestsOf, useSecrets } from '@/state/secrets';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { useWaitingSince } from '@/state/waiting';

export interface StackPrompts {
    prompts: CanvasPrompt[];
    /* The prompts of snoozed nodes, kept out of the stack until the snooze ends or a person ends it. */
    snoozed: CanvasPrompt[];
}

const NONE: StackPrompts = { prompts: [], snoozed: [] };

/*
 * The prompts of the canvas in this cell. It subscribes rather than selecting: every streamed word
 * changes the chats store, and the stack should only hear about a prompt that came or went.
 */
export function useCanvasPrompts(): StackPrompts {
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    const [prompts, setPrompts] = useState<StackPrompts>(NONE);

    useEffect(() => {
        const feeds = new Map<string, ChatPromptFeed>();
        const descendants = new Map<string, readonly PromptSubject[]>();
        const update = (): void => {
            const nodes = Object.values(canvasStore.getState().nodes);
            // The cards of every machine a node on this canvas runs on: a card belongs to the node that asks, wherever that runs.
            const machines = [...new Set([endpointId, ...nodes.map((node) => endpointOfNode(node, endpointId))])];
            const next = canvasPrompts({
                nodes,
                endpointId,
                sessions: useSessions.getState().byKey,
                chats: useChats.getState().byKey,
                descendants,
                computer: machines.flatMap(computerApprovalsOf),
                secrets: machines.flatMap(secretRequestsOf),
                proposals: machines.flatMap(proposalsOf),
                waitingSince: useWaitingSince.getState().byKey,
                snoozes: useSnoozes.getState().byKey
            });
            setPrompts((current) =>
                samePrompts(current.prompts, next.prompts) && samePrompts(current.snoozed, next.snoozed)
                    ? current
                    : { prompts: next.prompts, snoozed: next.snoozed }
            );
        };
        const reconcile = (): void => {
            const active = new Set<string>();
            for (const node of Object.values(canvasStore.getState().nodes)) {
                const machine = endpointOfNode(node, endpointId);
                // Every chat a node holds, a design node's later ones included.
                for (const chat of nodeChats(node)) {
                    const key = endpointKey(machine, chat.id);
                    active.add(key);
                    if (!feeds.has(key)) {
                        const feed = new ChatPromptFeed(chatScopeOf(machine), chat.id, (subjects) => {
                            descendants.set(key, subjects);
                            update();
                        });
                        feeds.set(key, feed);
                        feed.start();
                    }
                }
            }
            for (const [key, feed] of feeds) {
                if (!active.has(key)) {
                    feed.dispose();
                    feeds.delete(key);
                    descendants.delete(key);
                }
            }
            update();
        };
        reconcile();
        const unsubscribe = [
            canvasStore.subscribe(reconcile),
            subscribeChatThreads(update),
            useSessions.subscribe(update),
            useComputer.subscribe(update),
            useSecrets.subscribe(update),
            useProposals.subscribe(update),
            useSnoozes.subscribe(update)
        ];
        return () => {
            for (const feed of feeds.values()) {
                feed.dispose();
            }
            for (const off of unsubscribe) {
                off();
            }
        };
    }, [canvasStore, endpointId]);

    return prompts;
}
