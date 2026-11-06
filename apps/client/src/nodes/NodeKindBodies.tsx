import { Icon, Pill, Tooltip } from '@adecore/ui';
import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComputerIndicator } from '@/computer/ComputerIndicator';
import { useHasContextLinks } from '@/context/sources';
import { BrowserBody } from '@/nodes/BrowserBody';
import { ChatBody } from '@/nodes/ChatBody';
import { TerminalBody, TerminalPlate } from '@/nodes/TerminalBody';
import type { NodeBodyProps, NodeHeaderProps } from '@/registry/node-kinds';
import { SessionPorts } from '@/terminal/SessionPorts';

export function TerminalNodeBody({ id, live, focused }: NodeBodyProps) {
    return live ? <TerminalBody id={id} focused={focused} /> : <TerminalPlate id={id} />;
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

export function ChatNodeBody({ id, focused }: NodeBodyProps) {
    return <ChatBody id={id} focused={focused} onCanvas workflowsBeside />;
}

export function BrowserNodeBody({ id, active }: NodeBodyProps) {
    return <BrowserBody id={id} focused={active} />;
}
