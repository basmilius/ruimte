import { parseHostRef, type HostCheckState, type HostRef } from '@ruimte/contracts';
import { CircleCheck, CircleDashed, CircleMinus, CircleX, type LucideIcon } from 'lucide-react';

export const CHECK_ICONS: Record<HostCheckState, LucideIcon> = {
    pending: CircleDashed,
    success: CircleCheck,
    failure: CircleX,
    neutral: CircleMinus,
    skipped: CircleMinus
};

export const CHECK_COLORS: Record<HostCheckState, string> = {
    pending: 'text-status-running',
    success: 'text-positive',
    failure: 'text-status-error',
    neutral: 'text-text-faint',
    skipped: 'text-text-faint'
};

/* What a host calls an issue or a change, such as its number; the whole ref for one this version cannot take apart. */
export function shortRef(ref: HostRef): string {
    return parseHostRef(ref)?.locator ?? ref;
}
