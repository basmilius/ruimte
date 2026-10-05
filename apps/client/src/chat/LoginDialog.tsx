import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Terminal } from '@xterm/xterm';
import { Check, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderAccountStatus } from '@ruimte/contracts';
import { CliMark } from '@ruimte/agents-react/providers/parts';
import { useProviderAccountsStore } from '@ruimte/agents-react/state/provider-accounts';
import { useProvidersStore } from '@ruimte/agents-react/state/providers';
import { loginLanded } from '@/chat/login-landing';
import { NodeNotice } from '@/nodes/NodeNotice';
import { useEndpoints } from '@/state/endpoints';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';
import { useUi, type LoginRequest } from '@/state/ui';
import { readTerminalFont, readTerminalTheme } from '@/terminal/theme';
import { bindTerminalKeys, createTerminal, fitToHost } from '@/terminal/xterm';
import { transportFor, TransportError } from '@/transport';
import { sessionClientFor } from '@/transport/connections';
import { useEndpointConnection, useMachineHold } from '@/transport/status';
import { Button, CloseButton, copyText, Dialog, Icon } from '@basmilius/desktop-ui';

const RESIZE_DEBOUNCE_MS = 50;
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
    const resolvedTheme = useTheme((s) => s.resolved);
    const settingsVersion = useSettings((s) => s.version);
    const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
    // One session per attempt; a retry mounts this again under a new key.
    const [sessionId] = useState(() => `login-${crypto.randomUUID()}`);
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const refitRef = useRef<(() => void) | null>(null);
    const started = useRef(false);
    // The account as it read until this login started, which is what a landing has to differ from.
    const before = useRef<ProviderAccountStatus | null>(status);

    useEffect(() => {
        const host = hostRef.current;
        const sessions = sessionClientFor(endpointId);
        if (!host || !sessions) {
            return;
        }
        const term = createTerminal();
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());
        term.open(host);
        fitToHost(term, fit);
        termRef.current = term;
        bindTerminalKeys(term, { write: (data) => sessions.write(sessionId, data), clear: () => sessions.clear(sessionId), leaves: false });
        term.onData((data) => sessions.write(sessionId, data));
        const offs = [
            sessions.onOutput(sessionId, (data) => term.write(data)),
            // A reset through the parser (RIS), since `term.reset()` runs at once and output still queued would land on the fresh screen.
            sessions.onScreen(sessionId, ({ screen }) => term.write(`\x1bc${screen}`)),
            sessions.onExit(sessionId, () => setPhase({ kind: 'ended', dropped: false }))
        ];

        let size = { cols: term.cols, rows: term.rows };
        const refit = (): void => {
            fitToHost(term, fit);
            if (started.current && (term.cols !== size.cols || term.rows !== size.rows)) {
                size = { cols: term.cols, rows: term.rows };
                sessions.resize(sessionId, size.cols, size.rows);
            }
        };
        refitRef.current = refit;
        let timer: number | null = null;
        const observer = new ResizeObserver(() => {
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            timer = window.setTimeout(() => {
                timer = null;
                refit();
            }, RESIZE_DEBOUNCE_MS);
        });
        observer.observe(host);

        // Selecting copies, as in every terminal of the app; a login prints the address to open.
        const copySelection = (): void => {
            if (term.hasSelection()) {
                copyText(term.getSelection());
            }
        };
        host.addEventListener('pointerup', copySelection);

        return () => {
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            observer.disconnect();
            host.removeEventListener('pointerup', copySelection);
            offs.forEach((off) => off());
            term.dispose();
            termRef.current = null;
            refitRef.current = null;
            // The session is this dialog's alone; a retry starts another.
            if (started.current) {
                void sessions.kill(sessionId).catch(noop);
            }
        };
    }, [endpointId, sessionId]);

    useEffect(() => {
        const term = termRef.current;
        const link = transportFor(endpointId);
        const sessions = sessionClientFor(endpointId);
        if (!connected || started.current || !term || !link || !sessions) {
            return;
        }
        started.current = true;
        const start = async (): Promise<void> => {
            try {
                await link.request('session.login', { sessionId, kind, account: accountId, cols: term.cols, rows: term.rows });
                const attached = await sessions.open(sessionId, { follow: true }, term.cols, term.rows);
                if (termRef.current !== term) {
                    return;
                }
                if (attached) {
                    term.write(attached.screen);
                }
                setPhase((current) => (current.kind === 'starting' ? { kind: 'running' } : current));
                term.focus();
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

    useEffect(() => {
        const term = termRef.current;
        if (!term) {
            return;
        }
        term.options.theme = readTerminalTheme();
        term.options.fontFamily = readTerminalFont();
        term.options.fontSize = useSettings.getState().fontSize;
        term.options.lineHeight = useSettings.getState().terminalLineHeight;
        refitRef.current?.();
    }, [resolvedTheme, settingsVersion]);

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
                <div ref={hostRef} className="term-host" />
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
