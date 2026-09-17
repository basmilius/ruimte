import { useEffect, useRef, useState } from 'react';
import { canvasPrompts, samePrompts, type CanvasPrompt } from '@/canvas/prompts';
import { useCanvasStore } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';

const NONE: CanvasPrompt[] = [];

/*
 * The prompts of the canvas in this cell. It subscribes rather than selecting: every streamed word
 * changes the chats store, and the stack should only hear about a prompt that came or went.
 */
export const useCanvasPrompts = (): CanvasPrompt[] => {
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    const [prompts, setPrompts] = useState<CanvasPrompt[]>(NONE);
    const waitingSince = useRef(new Map<string, number>());

    useEffect(() => {
        const update = (): void => {
            const next = canvasPrompts({
                nodes: Object.values(canvasStore.getState().nodes),
                endpointId,
                sessions: useSessions.getState().byKey,
                chats: useChats.getState().byKey,
                approvalsOffered: useSettings.getState().agentsApprovals,
                waitingSince: waitingSince.current
            });
            waitingSince.current = next.waitingSince;
            setPrompts((current) => (samePrompts(current, next.prompts) ? current : next.prompts));
        };
        update();
        const unsubscribe = [canvasStore.subscribe(update), useChats.subscribe(update), useSessions.subscribe(update), useSettings.subscribe(update)];
        return () => {
            for (const off of unsubscribe) {
                off();
            }
        };
    }, [canvasStore, endpointId]);

    return prompts;
};
