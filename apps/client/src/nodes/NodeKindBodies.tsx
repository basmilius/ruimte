import { Icon, Pill, Tooltip } from '@adecore/ui';
import type { ProjectView } from '@ruimte/contracts';
import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComputerIndicator } from '@/computer/ComputerIndicator';
import { useHasContextLinks } from '@/context/sources';
import { BrowserBody, BrowserFallback } from '@/nodes/BrowserBody';
import { ChatBody } from '@/nodes/ChatBody';
import { TerminalBody, TerminalPlate } from '@/nodes/TerminalBody';
import { usePage } from '@/nodes/use-page';
import type { NodeBodyProps, NodeHeaderProps } from '@/registry/node-kinds';
import { SessionPorts } from '@/terminal/SessionPorts';

export function TerminalNodeBody({ id, sessionLive, focused }: NodeBodyProps) {
    return sessionLive ? <TerminalBody id={id} focused={focused} /> : <TerminalPlate id={id} />;
}

export function TerminalAfterTitle({ id, renaming }: NodeHeaderProps) {
    if (renaming) {
        return null;
    }
    return (
        <>
            <SessionPorts id={id} />
            <ComputerIndicator nodeId={id} />
        </>
    );
}

/* A terminal that a line makes readable to something else says so. */
export function TerminalContextPill({ id, renaming }: NodeHeaderProps) {
    const { t } = useTranslation('canvas');
    const hasContext = useHasContextLinks(id);
    if (!hasContext || renaming) {
        return null;
    }
    return (
        <Tooltip label={t('node.context.tooltip')}>
            <Pill icon={<Icon icon={Link2} size={12} />}>{t('node.context.pill')}</Pill>
        </Tooltip>
    );
}

export function ChatNodeBody({ id, focused, sessionLive }: NodeBodyProps) {
    return <ChatBody id={id} focused={focused} onCanvas workflowsBeside visible={sessionLive} />;
}

export function BrowserNodeBody({ id, active }: NodeBodyProps) {
    return <BrowserBody id={id} focused={active} />;
}

/* A chat of its own keeps a column of content as wide as the person's reading width, centered, with the surface filling what is left beside it. The scroller itself stays the width of the column, so its scrollbar sits at the column's own edge (`.chat-column` in `styles.css`). */
export function ChatViewBody({ view, focused }: { view: ProjectView; focused: boolean }) {
    return (
        <div className="chat-column flex h-full w-full flex-col">
            <ChatBody id={view.id} focused={focused} accessories={{ title: view.name }} />
        </div>
    );
}

export function TerminalViewBody({ view, focused }: { view: ProjectView; focused: boolean }) {
    return <TerminalBody id={view.id} focused={focused} />;
}

/* The page of a browser view is the parked element, placed over this whole column by the layer. A view without an address has no page yet, so what is left under it is the splash. */
export function BrowserViewBody({ view }: { view: ProjectView }) {
    usePage(view.id);
    return <BrowserFallback id={view.id} className="h-full" />;
}
