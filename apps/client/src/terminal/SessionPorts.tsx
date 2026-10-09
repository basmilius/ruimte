import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Pill, Tooltip } from '@adecore/ui';
import { CircleHelp, Unplug } from 'lucide-react';
import type { SessionPort, SessionPortsResult } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { isDesktop } from '@/desktop/bridge';
import { readNodeHost } from '@/nodes/node-host';
import { endpointKey } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useToasts } from '@/state/toasts';
import { windowWorkspace } from '@/state/window';
import { machineTransport } from '@/transport';
import { terminalLinkTarget } from './links';
import { SessionPortWatch } from './session-ports';
import { openVerifiedSessionPort } from './open-session-port';
import { publishSessionPortControls, useSessionPortControl } from './session-port-controls';

export function SessionPortMonitor({ id, endpointId }: { id: string; endpointId: string }) {
    const { t } = useTranslation('canvas');
    const [result, setResult] = useState<SessionPortsResult | null>(null);
    const [opening, setOpening] = useState(false);
    const [visible, setVisible] = useState(() => !document.hidden);
    const watcher = useRef<SessionPortWatch | null>(null);
    const localRoute = terminalLinkTarget('http://127.0.0.1', endpointId, isDesktop()) === 'web';

    useEffect(() => {
        const changed = (): void => setVisible(!document.hidden);
        document.addEventListener('visibilitychange', changed);
        return () => document.removeEventListener('visibilitychange', changed);
    }, []);

    useEffect(() => {
        if (!visible) {
            return;
        }
        const workspace = windowWorkspace();
        const key = endpointKey(endpointId, id);
        const restarts = useSessions.getState().restarts[key];
        const watch = new SessionPortWatch({
            transport: machineTransport(endpointId),
            sessionId: id,
            live: () => {
                const state = useSessions.getState();
                const row = state.byKey[key];
                return (
                    windowWorkspace() === workspace &&
                    workspace?.connection.endpointId === endpointId &&
                    state.restarts[key] === restarts &&
                    row?.attached === true &&
                    row.exited === undefined &&
                    readNodeHost(id)?.kind === 'terminal'
                );
            },
            changed: setResult
        });
        watcher.current = watch;
        void watch.poll();
        return () => {
            watch.stop();
            watcher.current = null;
        };
    }, [endpointId, id, visible]);

    const open = useCallback(
        async (port: SessionPort): Promise<void> => {
            if (!localRoute || !watcher.current) {
                return;
            }
            setOpening(true);
            try {
                await watcher.current.open(port, async (url, machineId) => {
                    if (terminalLinkTarget(url, endpointId, isDesktop()) !== 'web') {
                        return;
                    }
                    await openVerifiedSessionPort(id, url, machineId);
                });
            } catch {
                useToasts.getState().show({ kind: 'error', title: t('terminal.ports.openFailed'), description: t('terminal.ports.retry') });
            } finally {
                setOpening(false);
            }
        },
        [endpointId, id, localRoute, t]
    );

    useEffect(() => {
        if (!visible || result === null || result.status === 'closed' || (result.status === 'ready' && result.ports.length === 0)) {
            return;
        }
        return publishSessionPortControls(endpointKey(endpointId, id), { result, opening, localRoute, open });
    }, [endpointId, id, visible, result, opening, localRoute, open]);

    return null;
}

export function SessionPorts({ id }: { id: string }) {
    const { t } = useTranslation('canvas');
    const controls = useSessionPortControl(id);
    if (controls === null) {
        return null;
    }
    const { result, opening, localRoute, open } = controls;
    return (
        <div className="-m-1 flex min-w-0 max-w-1/2 items-center gap-1 overflow-x-auto p-1">
            {result.status === 'ready' ? (
                result.ports.map((port) => (
                    <Tooltip
                        key={`${port.pid}:${port.host}:${port.port}:${port.bindAddress ?? ''}`}
                        label={
                            localRoute
                                ? `${t('terminal.ports.open', { port: String(port.port) })}. ${t('terminal.ports.openHint')}`
                                : t('terminal.ports.remote')
                        }
                    >
                        <Pill className="tabular-nums" mono tone="raised" disabled={!localRoute || opening} onClick={() => void open(port)}>
                            <span className="sr-only">{t('terminal.ports.open', { port: String(port.port) })}</span>
                            <span aria-hidden>:{port.port}</span>
                        </Pill>
                    </Tooltip>
                ))
            ) : (
                <Tooltip label={t(result.status === 'unknown' ? 'terminal.ports.unknown' : 'terminal.ports.unavailable')}>
                    <Pill icon={<Icon icon={result.status === 'unknown' ? CircleHelp : Unplug} size={12} />}>
                        <span role="status" className="sr-only">
                            {t(result.status === 'unknown' ? 'terminal.ports.unknown' : 'terminal.ports.unavailable')}
                        </span>
                    </Pill>
                </Tooltip>
            )}
        </div>
    );
}
