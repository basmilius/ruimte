import { useEffect, useRef, type RefObject } from 'react';

export interface FocusAfterAnswer {
    /* Called before the front card changes, to remember whether the keyboard is in it, since the card is gone by the time the next one shows. */
    hold(): void;
    /* The card stays after all, as when its answer failed. */
    release(): void;
}

/*
 * The keyboard stays with the prompts it was answering: on the heading of the card that comes next, or
 * wherever `onEmpty` puts it once none is left. A card answered with the keyboard elsewhere takes nothing.
 */
export function useFocusAfterAnswer(activeId: string | null, container: RefObject<HTMLElement | null>, onEmpty: () => void): FocusAfterAnswer {
    const pending = useRef(false);

    useEffect(() => {
        if (!pending.current) {
            return;
        }
        pending.current = false;
        const heading = container.current?.querySelector<HTMLElement>('.prompt-heading');
        if (heading) {
            heading.focus({ preventScroll: true });
        } else {
            onEmpty();
        }
        // Only a change of the front card is news; a new `onEmpty` each render is not.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId]);

    return {
        hold: () => {
            pending.current = container.current?.contains(document.activeElement) === true;
        },
        release: () => {
            pending.current = false;
        }
    };
}
