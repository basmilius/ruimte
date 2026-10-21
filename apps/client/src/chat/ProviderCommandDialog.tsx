import { useEffect, useRef, useState } from 'react';
import type { TerminalViewHandle } from '@adecore/terminal';
import { RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CliMark } from '@adecore/agents-react/providers';
import { useProvidersStore } from '@adecore/agents-react/state';
import { Button, CloseButton, copyText, Dialog, Icon } from '@adecore/ui';
import { typeWhenReady } from '@/chat/provider-command';
import { NodeNotice } from '@/nodes/NodeNotice';
import { useEndpoints } from '@/state/endpoints';
import { useSettings } from '@/state/settings';
import { useUi, type ProviderCommandRequest } from '@/state/ui';
import { MachineTerminal } from '@/terminal/MachineTerminal';
import { bindTerminalKeys } from '@/terminal/xterm';
import { transportFor } from '@/transport';
import { sessionClientFor } from '@/transport/connections';
import { useEndpointConnection, useMachineHold } from '@/transport/status';

type Phase = { kind: 'starting' } | { kind: 'running' } | { kind: 'ended'; dropped: boolean } | { kind: 'failed'; reason: string };

function noop(): void {
    return undefined;
}

function closeCommand(): void {
    useUi.getState().setProviderCommand(null);
}

/*
 * A provider's install or sign-in command in a shell of its own, over the settings that asked for it, so it
 * needs no project. The command is typed and never sent: nothing starts a command a person did not run.
 */
export function ProviderCommandDialog() {
    const request = useUi((s) => s.providerCommand);
    // What the popup keeps showing while it animates closed, after the request is gone.
    const [shown, setShown] = useState(request);
    const [attempt, setAttempt] = useState(0);
    if (request !== null && request !== shown) {
        setShown(request);
    }

    return (
        <Dialog.Root open={request !== null} onOpenChange={(next) => (next ? undefined : closeCommand())}>
            <Dialog.Popup
                nested
                className="flex h-[520px] w-[760px] flex-col"
                onKeyDown={(e) => {
                    // Every open dialog root listens for Escape on the document, so without this one press would close the settings too.
                    if (e.key === 'Escape') {
                        e.stopPropagation();
                        closeCommand();
                    }
                }}
            >
                {shown && (
                    <CommandTerminal key={`${shown.endpointId}:${shown.command}:${attempt}`} request={shown} onRetry={() => setAttempt((count) => count + 1)} />
                )}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function CommandTerminal({ request, onRetry }: { request: ProviderCommandRequest; onRetry(): void }) {
    const { t } = useTranslation(['chat', 'canvas', 'common']);
    const { endpointId, kind, command } = request;
    const endpoint = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId) ?? null);
    useMachineHold(endpoint);
    const connected = useEndpointConnection(endpointId).status === 'open';
    const cli = useProvidersStore((s) => s.byScope[endpointId]?.providers.find((provider) => provider.kind === kind)?.name ?? kind);
    const fontSize = useSettings((s) => s.fontSize);
    const lineHeight = useSettings((s) => s.terminalLineHeight);
    const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
    // One shell per attempt; a retry mounts this again under a new key.
    const [sessionId] = useState(() => `provider-${crypto.randomUUID()}`);
    const viewRef = useRef<TerminalViewHandle>(null);
    const started = useRef(false);

    useEffect(() => {
        const view = viewRef.current;
        const term = view?.terminal;
        const sessions = sessionClientFor(endpointId);
        if (!view || !term || !sessions) {
            return;
        }
        bindTerminalKeys(term, { write: (data) => sessions.write(sessionId, data), clear: () => sessions.clear(sessionId), leaves: false });
        const offs = [
            sessions.onOutput(sessionId, (data) => view.write(data)),
            sessions.onScreen(sessionId, ({ screen }) => {
                view.reset();
                view.write(screen);
            }),
            sessions.onExit(sessionId, () => setPhase({ kind: 'ended', dropped: false })),
            typeWhenReady(sessions, sessionId, command, () => view.focus())
        ];

        // Selecting copies, as in every terminal of the app; an install prints what to do next.
        const copySelection = (): void => {
            if (term.hasSelection()) {
                copyText(term.getSelection());
            }
        };
        const element = term.element;
        element?.addEventListener('pointerup', copySelection);

        return () => {
            element?.removeEventListener('pointerup', copySelection);
            offs.forEach((off) => off());
            // The shell is this dialog's alone; closing it ends the shell.
            if (started.current) {
                void sessions.kill(sessionId).catch(noop);
            }
        };
    }, [endpointId, sessionId, command]);

    useEffect(() => {
        const view = viewRef.current;
        const link = transportFor(endpointId);
        const sessions = sessionClientFor(endpointId);
        if (!connected || started.current || !view || !link || !sessions) {
            return;
        }
        started.current = true;
        const start = async (): Promise<void> => {
            const { cols, rows } = view.size();
            try {
                await link.request('session.create', { sessionId, cols, rows });
                const attached = await sessions.open(sessionId, { follow: true }, { cols, rows });
                if (viewRef.current !== view) {
                    return;
                }
                if (attached) {
                    view.write(attached.screen);
                }
                setPhase((current) => (current.kind === 'starting' ? { kind: 'running' } : current));
                view.focus();
            } catch (e) {
                setPhase({ kind: 'failed', reason: e instanceof Error ? e.message : String(e) });
            }
        };
        void start();
    }, [connected, endpointId, sessionId]);

    useEffect(() => {
        if (phase.kind !== 'running') {
            return;
        }
        return transportFor(endpointId)?.subscribeStatus((next) => {
            if (next !== 'open') {
                setPhase({ kind: 'ended', dropped: true });
            }
        });
    }, [phase.kind, endpointId]);

    return (
        <>
            <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-hover">
                    <CliMark kind={kind} size={16} />
                </span>
                <div className="min-w-0 grow">
                    <Dialog.Title className="truncate">{cli}</Dialog.Title>
                    <Dialog.Description size="xs">{t('providerCommand.description')}</Dialog.Description>
                </div>
                <CloseButton label={t('common:action.close')} dialog />
            </div>
            <div className="relative min-h-0 grow bg-term-bg">
                <MachineTerminal
                    ref={viewRef}
                    endpointId={endpointId}
                    className="absolute inset-0"
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    onData={(data) => sessionClientFor(endpointId)?.write(sessionId, data)}
                    onResize={(cols, rows) => {
                        if (started.current) {
                            sessionClientFor(endpointId)?.resize(sessionId, cols, rows);
                        }
                    }}
                />
                {phase.kind === 'starting' && !connected && <NodeNotice>{t('canvas:notice.connecting')}</NodeNotice>}
                {phase.kind === 'failed' && (
                    <NodeNotice tone="error" onRetry={onRetry}>
                        {t('providerCommand.failed', { reason: phase.reason })}
                    </NodeNotice>
                )}
            </div>
            {phase.kind === 'ended' && (
                <div className="flex items-center gap-2 border-t border-border px-5 py-3">
                    <span className="grow text-xs text-text-muted">{phase.dropped ? t('providerCommand.dropped') : t('providerCommand.ended')}</span>
                    <Button variant="secondary" onClick={onRetry}>
                        <Icon icon={RotateCw} size={12} /> {t('common:action.retry')}
                    </Button>
                    <Button onClick={closeCommand}>{t('common:action.close')}</Button>
                </div>
            )}
        </>
    );
}
