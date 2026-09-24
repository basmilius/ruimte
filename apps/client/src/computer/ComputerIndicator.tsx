import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';
import i18next from 'i18next';
import { Pause, Play, Square, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerControlAction } from '@ruimte/contracts';
import { indicatorLook, useNodeComputerSession } from '@/computer/indicator';
import { useComputer } from '@/state/computer';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';
import { Icon } from '@/ui/Icon';
import { MenuPopup } from '@/ui/MenuPopup';
import { Tooltip } from '@/ui/Tooltip';

const ACTION_ICONS: Record<ComputerControlAction, LucideIcon> = {
    pause: Pause,
    resume: Play,
    stop: Square
};

/*
 * The arrow of the helper's phantom cursor (`PhantomForms.swift`, on its 24 by 24 box), drawn here
 * instead of a Lucide icon so the node wears the very mark the person sees moving on the screen.
 */
function CursorMark() {
    return (
        <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>
            <path d="M4 3.5L20.5 10.5L13.5 13.5L10.5 20.5Z" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
        </svg>
    );
}

function press(endpointId: string, action: ComputerControlAction): void {
    const link = transportFor(endpointId);
    if (!link) {
        return;
    }
    link.request('computer.control', { action })
        .then((status) => useComputer.getState().setStatus(endpointId, status))
        .catch((error: unknown) => {
            useToasts.getState().show({
                kind: 'error',
                title: i18next.t('computer:indicator.failed'),
                description: error instanceof Error ? error.message : String(error)
            });
        });
}

/* In the header of the chat or terminal whose agent operates the Mac right now; a click offers the session bar's buttons. */
export function ComputerIndicator({ nodeId }: { nodeId: string }) {
    const { t } = useTranslation('computer');
    const endpointId = useEndpointId();
    const mode = useNodeComputerSession(endpointId, nodeId);
    if (mode === null) {
        return null;
    }
    const look = indicatorLook(mode);
    return (
        <Menu.Root>
            <Tooltip label={look.label} name>
                <Menu.Trigger
                    className={clsx(
                        'icon-btn h-7 w-7 data-[popup-open]:bg-surface-active',
                        look.tone === 'accent' ? 'text-accent hover:text-accent' : 'text-text-muted'
                    )}
                >
                    <CursorMark />
                </Menu.Trigger>
            </Tooltip>
            <MenuPopup align="end">
                {look.actions.map((action) => (
                    <Menu.Item key={action} className="menu-item" onClick={() => press(endpointId, action)}>
                        <Icon icon={ACTION_ICONS[action]} size={14} />
                        {t(`indicator.${action}`)}
                    </Menu.Item>
                ))}
            </MenuPopup>
        </Menu.Root>
    );
}
