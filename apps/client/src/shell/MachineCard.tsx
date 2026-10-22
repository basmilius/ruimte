import type { ReactNode } from 'react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { describeLastSeen } from '@/shell/connection-info';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { nameOf } from '@/shell/settings/machine-list';
import { StatusCard } from '@/shell/StatusCard';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { useLastSeenAt } from '@/transport/status';
import { BrandSymbol } from '@/ui/Brand';
import { useNow } from '@adecore/ui';

const MINUTE_MS = 60_000;

/*
 * A machine that does not answer, drawn the same wherever it shows: over the workspace, in a switch
 * whose machine did not answer and in a remote node. Ruimte's own icon, since the card is about Ruimte
 * reaching a machine and not about whatever project was open; the machine is the subject.
 */
export function MachineCard({
    machine,
    line,
    failed,
    seen = true,
    children
}: {
    machine: string;
    line: string;
    failed: boolean;
    /* Off where the time it last answered says nothing, such as a node whose machine answers this window. */
    seen?: boolean;
    children?: ReactNode;
}) {
    const entry = useMachineEntry(machine);
    const icon = useMachineIcon(entry);
    const lastSeen = useLastSeenAt(machine);
    const now = useNow(MINUTE_MS);
    const lastSeenLine = seen ? describeLastSeen(lastSeen, now) : null;
    return (
        <StatusCard
            glyph={<BrandSymbol size={24} className="rounded-[5px]" />}
            title={nameOf(entry)}
            meta={
                lastSeenLine && (
                    <span className="flex max-w-full items-center gap-1.5 text-xs text-text-muted">
                        <MachineGlyph icon={icon} size={12} />
                        <span className="truncate">{lastSeenLine}</span>
                    </span>
                )
            }
            line={line}
            failed={failed}
        >
            {children}
        </StatusCard>
    );
}
