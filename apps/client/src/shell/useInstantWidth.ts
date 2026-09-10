import { useUi } from '@/state/ui';

/*
 * Whether a column has to land at its width instead of sliding to it. The columns start closed and
 * a project puts its own back when it opens, from its local file: that has to be on screen at its
 * final width from the first paint it appears in. So the flag is on from the first render until a
 * person moves a column by hand, and on again for every project that opens after that. The change
 * a person makes turns it off in the same commit, which is what makes that change the one that
 * slides: a transition starts on the style the change lands in, not on the one before it.
 */
export function useInstantWidth(): boolean {
    return useUi((s) => s.panelsRestoring);
}
