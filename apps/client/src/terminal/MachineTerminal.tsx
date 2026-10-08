import { useState } from 'react';
import { TerminalView, type TerminalViewProps, type TerminalLinkBounds } from '@adecore/terminal';
import { Tooltip } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { isApplePlatform, isDesktop } from '@/desktop/bridge';
import { useEndpoints } from '@/state/endpoints';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useWindow, workspaceOf } from '@/state/window';
import { isTerminalLinkClick, openTerminalLink, terminalLinkTarget } from './links';
import { openTerminalLinkInRuimte } from './open-in-ruimte';

type MachineTerminalProps = Omit<TerminalViewProps, 'onOpenLink' | 'onLinkHover'> & { endpointId: string; sourceId?: string };

export function MachineTerminal({ endpointId, sourceId, className, ...props }: MachineTerminalProps) {
    const { t } = useTranslation('canvas');
    const [hovered, setHovered] = useState<{ uri: string; bounds: TerminalLinkBounds } | null>(null);
    const machine = useEndpoints((state) => state.endpoints.find((entry) => entry.id === endpointId)?.label);
    const destination = useSettings((state) => state.terminalLinkDestination);
    const workspaceEndpointId = useWindow((state) => workspaceOf(state.content)?.connection.endpointId);
    const inRuimte = destination === 'ruimte' && workspaceEndpointId === endpointId;
    const apple = isApplePlatform();
    const remoteMessage = t('terminal.links.remoteLoopback', { machine: machine ?? t('terminal.links.thisMachine') });
    const blocked = hovered !== null && terminalLinkTarget(hovered.uri, endpointId, isDesktop()) === 'remote-loopback';

    return (
        <div className={className}>
            <TerminalView
                {...props}
                className="absolute inset-0"
                onLinkHover={(uri, bounds) => setHovered(uri === null || bounds === null ? null : { uri, bounds })}
                onOpenLink={(uri, event) => {
                    if (isTerminalLinkClick(event, apple)) {
                        openTerminalLink(uri, endpointId, {
                            openInRuimte: inRuimte ? (url) => openTerminalLinkInRuimte(url, endpointId, sourceId) : undefined,
                            unavailable: () =>
                                useToasts.getState().show({
                                    kind: 'error',
                                    title: t('terminal.links.unavailable'),
                                    description: remoteMessage
                                })
                        });
                    }
                }}
            />
            <Tooltip
                open={hovered !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setHovered(null);
                    }
                }}
                anchor={hovered ? { getBoundingClientRect: () => DOMRect.fromRect(hovered.bounds) } : null}
                label={
                    <>
                        {blocked ? remoteMessage : t(inRuimte ? 'terminal.links.openInRuimte' : 'terminal.links.open', { modifier: apple ? '⌘' : 'Ctrl' })}
                        <br />
                        <span className="text-text-muted">{hovered?.uri}</span>
                    </>
                }
            />
        </div>
    );
}
