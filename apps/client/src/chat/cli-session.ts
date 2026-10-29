import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TerminalViewHandle } from '@adecore/terminal';
import { copyText, messageOf } from '@adecore/ui';
import { typeWhenReady } from '@/chat/provider-command';
import { useEndpoints } from '@/state/endpoints';
import { bindTerminalKeys } from '@/terminal/xterm';
import { transportFor, type Transport } from '@/transport';
import { sessionClientFor } from '@/transport/connections';
import { useEndpointConnection, useMachineHold } from '@/transport/status';

type CliPhase =
    | { kind: 'starting' }
    | { kind: 'running' }
    | { kind: 'landed' }
    // The shell ended, or the connection did, which ends the session on the machine as well.
    | { kind: 'ended'; dropped: boolean }
    | { kind: 'failed'; reason: string };

interface CliSessionOptions {
    endpointId: string;
    sessionPrefix: string;
    start(link: Transport, size: { sessionId: string; cols: number; rows: number }): Promise<unknown>;
    /* Typed into the shell once its prompt is drawn, never with an Enter. */
    typed?: string;
    onStarted?(link: Transport): void;
}

export interface CliSession {
    phase: CliPhase;
    setPhase(phase: CliPhase): void;
    connected: boolean;
    sessionId: string;
    viewRef: RefObject<TerminalViewHandle | null>;
    started: RefObject<boolean>;
}

/* A CLI's own session in a dialog of its own, started once the machine is connected and ended with the dialog. */
export function useCliSession({ endpointId, sessionPrefix, start, typed, onStarted }: CliSessionOptions): CliSession {
    const endpoint = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId) ?? null);
    useMachineHold(endpoint);
    const connected = useEndpointConnection(endpointId).status === 'open';
    const [phase, setPhase] = useState<CliPhase>({ kind: 'starting' });
    // One session per attempt; a retry mounts this again under a new key.
    const [sessionId] = useState(() => `${sessionPrefix}-${crypto.randomUUID()}`);
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
            sessions.onExit(sessionId, () => setPhase({ kind: 'ended', dropped: false }))
        ];
        if (typed !== undefined) {
            offs.push(typeWhenReady(sessions, sessionId, typed, () => view.focus()));
        }

        // Selecting copies, as in every terminal of the app; a login prints the address to open, an install what to do next.
        const copySelection = (): void => {
            if (term.hasSelection()) {
                copyText(term.getSelection());
            }
        };
        // A press in the terminal gives it the keyboard, whatever the dialogs around it did with the focus.
        const focusTerminal = (): void => view.focus();
        const element = term.element;
        element?.addEventListener('pointerup', copySelection);
        element?.addEventListener('pointerdown', focusTerminal);

        return () => {
            element?.removeEventListener('pointerup', copySelection);
            element?.removeEventListener('pointerdown', focusTerminal);
            offs.forEach((off) => off());
            // The session is this dialog's alone; a retry starts another.
            if (started.current) {
                void sessions.kill(sessionId).catch(() => undefined);
            }
        };
    }, [endpointId, sessionId, typed]);

    useEffect(() => {
        const view = viewRef.current;
        const link = transportFor(endpointId);
        const sessions = sessionClientFor(endpointId);
        if (!connected || started.current || !view || !link || !sessions) {
            return;
        }
        started.current = true;
        const run = async (): Promise<void> => {
            const { cols, rows } = view.size();
            try {
                await start(link, { sessionId, cols, rows });
                const attached = await sessions.open(sessionId, { follow: true }, { cols, rows });
                if (viewRef.current !== view) {
                    return;
                }
                if (attached) {
                    view.write(attached.screen);
                }
                setPhase((current) => (current.kind === 'starting' ? { kind: 'running' } : current));
                view.focus();
                onStarted?.(link);
            } catch (e) {
                setPhase({ kind: 'failed', reason: messageOf(e) });
            }
        };
        void run();
    }, [connected, endpointId, sessionId, start, onStarted]);

    /* A login's code flow sends a person to the browser for a code, and the code is typed on return. A
       window that comes back with the focus on nothing gives it to the terminal; focus that landed on
       a control or another popup stays there. */
    useEffect(() => {
        if (phase.kind !== 'running') {
            return;
        }
        let frame = 0;
        const onFocus = (): void => {
            frame = requestAnimationFrame(() => {
                if (document.activeElement === null || document.activeElement === document.body) {
                    viewRef.current?.focus();
                }
            });
        };
        window.addEventListener('focus', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            cancelAnimationFrame(frame);
        };
    }, [phase.kind]);

    // The machine ends a session whose client left, so a link that drops ends this one too.
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

    return { phase, setPhase, connected, sessionId, viewRef, started };
}
