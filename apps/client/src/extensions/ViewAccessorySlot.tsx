import { useChats } from '@adecore/agents-react/state';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { provideViewFocus } from '@/extensions/view-focus';
import { currentEndpointId } from '@/state/current-endpoint';
import { endpointKey } from '@/state/keys';

/*
 * Temporary: the composer card is ADE CORE's and has no stable hook of its own yet, so the host finds it by its class.
 * Only the host reads it; an extension gets where the card lies through the slot's `composer`, and `views.focus`.
 */
const COMPOSER_CARD = '[class~="@container/composer"]';

interface ComposerEdge {
    top: number;
    right: number;
    width: number;
}

/* Where the composer's card lies in the box, measured again whenever either changes size or the card comes and goes. */
function useComposerEdge(box: RefObject<HTMLDivElement | null>): ComposerEdge | null {
    const [edge, setEdge] = useState<ComposerEdge | null>(null);

    useEffect(() => {
        const element = box.current;
        const scope = element?.parentElement ?? null;

        if (element === null || scope === null || typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(() => measure());
        let watched: Element | null = null;

        // Found again on every change: the activity line over the card comes and goes.
        const measure = (): void => {
            const card = scope.querySelector(COMPOSER_CARD);

            if (card !== watched) {
                if (watched !== null) {
                    observer.unobserve(watched);
                }

                if (card !== null) {
                    observer.observe(card);
                }

                watched = card;
            }

            if (card === null) {
                setEdge(null);

                return;
            }

            const outer = element.getBoundingClientRect();
            const rect = card.getBoundingClientRect();
            const next = { top: Math.round(rect.top - outer.top), right: Math.round(outer.right - rect.right), width: Math.round(rect.width) };

            setEdge((current) => (current?.top === next.top && current.right === next.right && current.width === next.width ? current : next));
        };

        observer.observe(element);
        measure();

        return () => observer.disconnect();
    }, [box]);

    return edge;
}

/* What a press on a chat's accessory gives the keyboard to: the question it waits on, or else the field to write in. */
function focusComposer(scope: HTMLElement | null, chatId: string): void {
    const card = scope?.querySelector<HTMLElement>(COMPOSER_CARD) ?? null;

    if (card === null) {
        return;
    }

    const info = useChats.getState().statusByKey[endpointKey(currentEndpointId(), chatId)]?.info;
    const waiting = info?.status === 'needs-you' || (info?.requests ?? []).length > 0;
    // The field is an editor in ADE CORE's composer; its editable content is what takes the keys.
    const input = card.querySelector<HTMLElement>('.composer-input [contenteditable="true"]');
    const answer = card.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]');

    (waiting ? (answer ?? input) : (input ?? answer))?.focus();
}

/* The `viewAccessory` slot of a chat open as a view of its own: a box over its composer, which takes no press itself. */
export function ChatViewAccessory({ id }: { id: string }) {
    const box = useRef<HTMLDivElement>(null);
    const composer = useComposerEdge(box);

    useEffect(() => provideViewFocus(id, () => focusComposer(box.current?.parentElement ?? null, id)), [id]);

    return (
        <div ref={box} className="pointer-events-none absolute inset-0">
            <SlotRow place="viewAccessory" context={{ target: { id, kind: 'chat' }, composer }} />
        </div>
    );
}

/* The same slot in a terminal view's bar, where a widget stands as it is; a press hands the keyboard to the terminal. */
export function TerminalViewAccessory({ id, focus }: { id: string; focus: () => void }) {
    useEffect(() => provideViewFocus(id, focus), [id, focus]);

    return <SlotRow place="viewAccessory" context={{ target: { id, kind: 'terminal' }, composer: null }} />;
}
