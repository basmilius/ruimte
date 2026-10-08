import { useEffect, useRef, useState } from 'react';
import type { TerminalViewHandle } from '@adecore/terminal';
import { MachineTerminal } from '@/terminal/MachineTerminal';
import { Check, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderAccountStatus } from '@ruimte/contracts';
import { CliMark } from '@adecore/agents-react/providers/parts';
import { useProviderAccountsStore } from '@adecore/agents-react/state/provider-accounts';
import { useProvidersStore } from '@adecore/agents-react/state/providers';
import { loginLanded } from '@/chat/login-landing';
import { NodeNotice } from '@/nodes/NodeNotice';
import { useEndpoints } from '@/state/endpoints';
import { useSettings } from '@/state/settings';
import { useUi, type LoginRequest } from '@/state/ui';
import { bindTerminalKeys } from '@/terminal/xterm';
import { transportFor, TransportError } from '@/transport';
import { sessionClientFor } from '@/transport/connections';
import { useEndpointConnection, useMachineHold } from '@/transport/status';
import { Button, CloseButton, copyText, Dialog, Icon } from '@adecore/ui';

/* Long enough to read that it worked, short enough not to wait on it. */
const LANDED_MS = 1_200;

type Phase =
    | { kind: 'starting' }
    | { kind: 'running' }
    | { kind: 'landed' }
    // The shell ended, or the connection did, which ends a login on the machine as well.
    | { kind: 'ended'; dropped: boolean }
    // A machine from before `session.login`.
    | { kind: 'outdated' }
    | { kind: 'failed'; reason: string };

function noop(): void {
    return undefined;
}

function closeLogin(): void {
    return useUi.getState().setLogin(null);
}

/*
 * The CLI's own login in a terminal of its own, for a machine no canvas on screen can hold a terminal
 * node of. Mounted once beside the other dialogs, so the onboarding and the settings both open it, and
 * `nested` puts it over whichever of them asked.
 */
export function LoginDialog() {
    const request = useUi((s) => s.login);
    // What the popup keeps showing while it animates closed, after the request is gone.
    const [shown, setShown] = useState(request);
    const [attempt, setAttempt] = useState(0);
    if (request !== null && request !== shown) {
        setShown(request);
    }

    return (
        <Dialog.Root open={request !== null} onOpenChange={(next) => (next ? undefined : closeLogin())}>
            <Dialog.Popup
                nested
                className="flex h-[520px] w-[760px] flex-col"
                onKeyDown={(e) => {
                    // Every open dialog root listens for Escape on the document, so without this one press would close the one underneath too.
                    if (e.key === 'Escape') {
                        e.stopPropagation();
                        closeLogin();
                    }
                }}
            >
                {shown && (
                    <LoginTerminal key={`${shown.endpointId}:${shown.accountId}:${attempt}`} request={shown} onRetry={() => setAttempt((count) => count + 1)} />
                )}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function LoginTerminal({ request, onRetry }: { request: LoginRequest; onRetry(): void }) {
    const { t } = useTranslation(['chat', 'canvas', 'common']);
    const { endpointId, kind, accountId, name } = request;
    const endpoint = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId) ?? null);
    useMachineHold(endpoint);
    const connected = useEndpointConnection(endpointId).status === 'open';
    const status = useProviderAccountsStore((s) => s.byScope[endpointId]?.accounts?.statuses.find((entry) => entry.id === accountId) ?? null);
    const cli = useProvidersStore((s) => s.byScope[endpointId]?.providers.find((provider) => provider.kind === kind)?.name ?? kind);
    const fontSize = useSettings((s) => s.fontSize);
    const lineHeight = useSettings((s) => s.terminalLineHeight);
    const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
    // One session per attempt; a retry mounts this again under a new key.
    const [sessionId] = useState(() => `login-${crypto.randomUUID()}`);
    const viewRef = useRef<TerminalViewHandle>(null);
    const started = useRef(false);
    // The account as it read until this login started, which is what a landing has to differ from.
    const before = useRef<ProviderAccountStatus | null>(status);

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
            sessions.onExit(sessionId, () => setPhase({ kind: 'ended', dropped: false }))
        ];

        // Selecting copies, as in every terminal of the app; a login prints the address to open.
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
            // The session is this dialog's alone; a retry starts another.
            if (started.current) {
                void sessions.kill(sessionId).catch(noop);
            }
        };
    }, [endpointId, sessionId]);

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
                await link.request('session.login', { sessionId, kind, account: accountId, cols, rows });
                const attached = await sessions.open(sessionId, { follow: true }, cols, rows);
                if (viewRef.current !== view) {
                    return;
                }
                if (attached) {
                    view.write(attached.screen);
                }
                setPhase((current) => (current.kind === 'starting' ? { kind: 'running' } : current));
                view.focus();
                // Watching is a courtesy: the status still arrives on the machine's own clock.
                void link.request('accounts.watchLogin', { id: accountId }).catch(noop);
            } catch (e) {
                if (e instanceof TransportError && e.code === 'unknown-request') {
                    setPhase({ kind: 'outdated' });
                } else {
                    setPhase({ kind: 'failed', reason: e instanceof Error ? e.message : String(e) });
                }
            }
        };
        void start();
    }, [connected, endpointId, sessionId, kind, accountId]);

    // The machine ends a login whose client left, so a link that drops ends this one too.
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

    useEffect(() => {
        if (phase.kind === 'starting') {
            before.current = status;
        } else if (phase.kind === 'running' && loginLanded(before.current, status)) {
            setPhase({ kind: 'landed' });
        }
    }, [phase.kind, status]);

    useEffect(() => {
        if (phase.kind !== 'landed') {
            return;
        }
        const timer = window.setTimeout(closeLogin, LANDED_MS);
        return () => window.clearTimeout(timer);
    }, [phase.kind]);

    return (
        <>
            <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-hover">
                    <CliMark kind={kind} size={16} />
                </span>
                <div className="min-w-0 grow">
                    <Dialog.Title className="truncate">{t('login.title', { account: name })}</Dialog.Title>
                    <Dialog.Description size="xs">{t('login.description', { cli })}</Dialog.Description>
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
                {phase.kind === 'outdated' && <NodeNotice>{t('login.outdated')}</NodeNotice>}
                {phase.kind === 'failed' && (
                    <NodeNotice tone="error" onRetry={onRetry}>
                        {t('login.failed', { reason: phase.reason })}
                    </NodeNotice>
                )}
            </div>
            {phase.kind === 'landed' && (
                <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-status-idle" role="status">
                    <Icon icon={Check} size={14} />
                    {status?.email ? t('login.landedAs', { email: status.email }) : t('login.landed')}
                </div>
            )}
            {phase.kind === 'ended' && (
                <div className="flex items-center gap-2 border-t border-border px-5 py-3">
                    <span className="grow text-xs text-text-muted">{phase.dropped ? t('login.dropped') : t('login.ended')}</span>
                    <Button variant="secondary" onClick={onRetry}>
                        <Icon icon={RotateCw} size={12} /> {t('common:action.retry')}
                    </Button>
                    <Button onClick={closeLogin}>{t('common:action.close')}</Button>
                </div>
            )}
        </>
    );
}
