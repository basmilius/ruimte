import i18next from 'i18next';

/* Where a surface that floats on its own says it failed: a card, so the rest of the window stays usable. */
export const FLOATING_FAILURE = 'fixed inset-x-0 bottom-4 z-(--z-dialog) mx-auto w-fit rounded-lg border border-border shadow-float';

export function failed(surface: string): string {
    return i18next.t(`common:state.failed.${surface}`);
}
