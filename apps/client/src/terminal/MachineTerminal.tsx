import { trackOutputCwd } from './output-cwd';
import { openFileLink } from '@/shell/panels/file-links';
import { bindTerminalFileLinks, type TerminalFileLink } from './file-links';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { TerminalView, type TerminalViewProps, type TerminalLinkBounds, type TerminalViewHandle } from '@adecore/terminal';
import { Tooltip } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { isApplePlatform, isDesktop } from '@/desktop/bridge';
import { useEndpoints } from '@/state/endpoints';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useWindow, workspaceOf } from '@/state/window';
import { isTerminalLinkClick, openTerminalLink, terminalLinkTarget } from './links';
import { openTerminalLinkInRuimte } from './open-in-ruimte';

type MachineTerminalProps = Omit<TerminalViewProps, 'onOpenLink' | 'onLinkHover'> & {
    endpointId: string;
    sourceId?: string;
    onFileLinkHover?: (link: TerminalFileLink | null) => void;
};

type HoveredLink = { endpointId: string; sourceId?: string; bounds: TerminalLinkBounds } & ({ kind: 'url'; uri: string } | { kind: 'file'; text: string });

export function MachineTerminal({ endpointId, sourceId, onFileLinkHover, className, ref, ...props }: MachineTerminalProps) {
    const { t } = useTranslation('canvas');
    const viewRef = useRef<TerminalViewHandle>(null);
    const [hovered, setHovered] = useState<HoveredLink | null>(null);
    useImperativeHandle(ref, () => viewRef.current!, []);

    useEffect(() => {
        const term = viewRef.current?.terminal;
        if (!term) {
            return;
        }
        const cwd = trackOutputCwd(term);
        const unbind = bindTerminalFileLinks(term, cwd.at, endpointId, {
            open: (link, event) => {
                if (isTerminalLinkClick(event, isApplePlatform())) {
                    void openFileLink(null, link.ref, endpointId);
                }
            },
            hover: (link, bounds) => {
                onFileLinkHover?.(link);
                setHovered((current) => {
                    if (!link || !bounds) {
                        return current?.kind === 'file' ? null : current;
                    }
                    if (
                        current?.kind === 'file' &&
                        current.text === link.text &&
                        current.endpointId === endpointId &&
                        current.sourceId === sourceId &&
                        current.bounds.x === bounds.x &&
                        current.bounds.y === bounds.y &&
                        current.bounds.width === bounds.width &&
                        current.bounds.height === bounds.height
                    ) {
                        return current;
                    }
                    return { kind: 'file', text: link.text, bounds, endpointId, sourceId };
                });
            }
        });
        const clear = (): void => setHovered(null);
        const changes = [term.onScroll(clear), term.onResize(clear), term.onWriteParsed(clear)];
        term.element?.addEventListener('mouseleave', clear);
        term.element?.addEventListener('wheel', clear, { passive: true });
        return () => {
            clear();
            changes.forEach((change) => change.dispose());
            term.element?.removeEventListener('mouseleave', clear);
            term.element?.removeEventListener('wheel', clear);
            unbind();
            cwd.dispose();
        };
    }, [endpointId, sourceId, onFileLinkHover]);
    const link = hovered?.endpointId === endpointId && hovered.sourceId === sourceId ? hovered : null;
    const machine = useEndpoints((state) => state.endpoints.find((entry) => entry.id === endpointId)?.label);
    const destination = useSettings((state) => state.terminalLinkDestination);
    const workspaceEndpointId = useWindow((state) => workspaceOf(state.content)?.connection.endpointId);
    const inRuimte = destination === 'ruimte' && workspaceEndpointId === endpointId;
    const apple = isApplePlatform();
    const remoteMessage = t('terminal.links.remoteLoopback', { machine: machine ?? t('terminal.links.thisMachine') });
    const blocked = link?.kind === 'url' && terminalLinkTarget(link.uri, endpointId, isDesktop()) === 'remote-loopback';

    return (
        <div className={className}>
            <TerminalView
                {...props}
                ref={viewRef}
                className="absolute inset-0"
                onLinkHover={(uri, bounds) =>
                    setHovered((current) =>
                        uri === null || bounds === null ? (current?.kind === 'url' ? null : current) : { kind: 'url', uri, bounds, endpointId, sourceId }
                    )
                }
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
                open={link !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setHovered(null);
                    }
                }}
                anchor={link ? { getBoundingClientRect: () => DOMRect.fromRect(link.bounds) } : null}
                label={
                    <>
                        {blocked
                            ? remoteMessage
                            : t(link?.kind === 'file' ? 'terminal.links.openFile' : inRuimte ? 'terminal.links.openInRuimte' : 'terminal.links.open', {
                                  modifier: apple ? '⌘' : 'Ctrl'
                              })}
                        <br />
                        <span className="text-text-muted">{link?.kind === 'file' ? link.text : link?.uri}</span>
                    </>
                }
            />
        </div>
    );
}
