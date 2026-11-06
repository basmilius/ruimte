import { UNDO_MS } from '@adecore/ui';
import i18next from 'i18next';
import { viewIdsIn, type ShownView } from '@/layout/split';
import { useDocument, type DocumentState } from '@/state/document';
import { useToasts } from '@/state/toasts';

/* One card per window, so a newer show replaces the one before and only its way back is on offer. */
export const SHOW_TOAST_ID = 'show-view';

/* The one button the card offers, and when pressing it would no longer do what it says. */
export interface ShowOffer {
    label: 'goThere' | 'back';
    run(): void;
    stale?(state: DocumentState): boolean;
}

let stopWatch: (() => void) | null = null;

/* What the grid shows, without the sizes: dragging a divider leaves a way back as true as it was. */
function gridOf(state: DocumentState): string {
    return `${state.activeViewId}|${state.layout === null ? '' : viewIdsIn(state.layout).join(',')}`;
}

/* A way back out of a show describes the grid right after it, so moving a view by hand makes it stale. */
export function backOffer(shown: Omit<ShownView, 'layout'>): ShowOffer {
    const after = gridOf(useDocument.getState());

    return {
        label: 'back',
        run: () => useDocument.getState().undoShowView(shown),
        stale: (state) => gridOf(state) !== after
    };
}

/* Done once the person is there by other means, and a door into nothing once the view is gone. */
export function goOffer(viewId: string): ShowOffer {
    return {
        label: 'goThere',
        run: () => useDocument.getState().setActiveView(viewId),
        stale: (state) => state.activeViewId === viewId || !state.views.some((view) => view.id === viewId)
    };
}

/* Says what an agent or a person put on screen, with the way back or over to it; without an offer it only reports. */
export function showMoveToast(title: string, offer: ShowOffer | null): void {
    stopWatch?.();
    stopWatch = null;

    if (offer === null) {
        useToasts.getState().show({ id: SHOW_TOAST_ID, kind: 'success', title });

        return;
    }

    const dismiss = (): void => useToasts.getState().dismiss(SHOW_TOAST_ID);
    const unsubscribe =
        offer.stale === undefined
            ? () => undefined
            : useDocument.subscribe((state) => {
                  if (offer.stale?.(state)) {
                      dismiss();
                  }
              });
    const stop = (): void => {
        unsubscribe();

        if (stopWatch === stop) {
            stopWatch = null;
        }
    };

    stopWatch = stop;
    useToasts.getState().show({
        id: SHOW_TOAST_ID,
        kind: 'success',
        title,
        lifetime: UNDO_MS,
        action: {
            label: i18next.t(`shell:projectBanner.${offer.label}`),
            run: () => {
                // Off the screen before the move, so the move cannot find a stale card to take away.
                dismiss();
                offer.run();
            }
        },
        onClose: stop
    });
}
