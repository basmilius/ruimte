import type { ReactElement } from 'react';
import { Tooltip } from '@/ui/Tooltip';

/*
 * Why a row cannot be picked, in a tooltip beside it rather than in the row itself: a reason is a
 * sentence, and a sentence in a menu row sets the width of the whole menu. A row with nothing in its
 * way is handed through untouched, so it carries no tooltip at all.
 */
export function DisabledReason({ reason, children }: { reason: string | null; children: ReactElement<Record<string, unknown>> }) {
    if (reason === null) {
        return children;
    }
    return (
        <Tooltip label={reason} side="right">
            {children}
        </Tooltip>
    );
}
