import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { RotateCw } from 'lucide-react';
import { useCanvas } from '@/state/canvas';
import { useSessions } from '@/state/sessions';
import { useTheme } from '@/state/theme';
import { sessionClient } from '@/terminal';
import { registerTerminal } from '@/terminal/registry';
import { readTerminalFont, readTerminalTheme } from '@/terminal/theme';
import { useTransportStatus } from '@/transport/status';

const FONT_SIZE = 12.5;
const RESIZE_DEBOUNCE_MS = 50;
/* ESC CR: what agent CLIs read as "newline, do not submit". Harmless in a plain shell. */
const SHIFT_ENTER = '\x1b\r';

let webgl2Available: boolean | null = null;

/* Probed once for the page; the probe context is released so it does not count against the browser's cap. */
const hasWebgl2 = (): boolean => {
    if (webgl2Available === null) {
        const context = document.createElement('canvas').getContext('webgl2');
        webgl2Available = context !== null;
        context?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return webgl2Available;
};

const createTerminal = (): Terminal =>
    new Terminal({
        theme: readTerminalTheme(),
        fontFamily: readTerminalFont(),
        fontSize: FONT_SIZE,
        cursorBlink: true,
        scrollback: 5000,
        macOptionIsMeta: true
    });

const loadRenderer = (term: Terminal): void => {
    if (!hasWebgl2()) {
        return;
    }
    try {
        const webgl = new WebglAddon();
        // Once the GPU drops the context xterm's DOM renderer takes over; nothing to re-acquire.
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
    } catch {
        // The DOM renderer is already active; WebGL was only ever an upgrade.
    }
};

export function TerminalNode({ id, focused }: { id: string; focused: boolean }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    /* Bumped by Restart: the whole terminal is rebuilt around a fresh session. */
    const [generation, setGeneration] = useState(0);
    const [failure, setFailure] = useState<string | null>(null);
    const status = useTransportStatus();
    const exited = useSessions((s) => s.byNodeId[id]?.exited);
    const resolvedTheme = useTheme((t) => t.resolved);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        const term = createTerminal();
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());
        term.open(host);
        loadRenderer(term);
        fit.fit();
        termRef.current = term;

        term.attachCustomKeyEventHandler((e) => {
            if (e.key === 'Escape') {
                // Escape always returns to the canvas, so a full-screen program (vim, less) never
                // receives it. That trade keeps "Escape leaves node mode" absolute; a later phase can
                // add a per-node "send Escape to the app" toggle for the programs that need it.
                return false;
            }
            if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                sessionClient.write(id, SHIFT_ENTER);
                return false;
            }
            return true;
        });
        term.onData((data) => sessionClient.write(id, data));

        let cancelled = false;
        const unregister = registerTerminal(id, term);
        const offOutput = sessionClient.onOutput(id, (data) => term.write(data));
        const offScreen = sessionClient.onScreen(id, ({ screen }) => {
            term.reset();
            term.write(screen);
        });

        const cwd = useCanvas.getState().nodes[id]?.cwd;
        sessionClient.open(id, cwd, term.cols, term.rows)
            .then((result) => {
                if (!cancelled && result) {
                    term.write(result.screen);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setFailure(e instanceof Error ? e.message : 'The session could not be started');
                }
            });

        // The host is sized in world units, so a camera zoom (a CSS transform on an ancestor)
        // never reaches this observer: only a real node resize changes cols and rows.
        let timer: number | null = null;
        const observer = new ResizeObserver(() => {
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            timer = window.setTimeout(() => {
                timer = null;
                const { cols, rows } = term;
                fit.fit();
                if (term.cols !== cols || term.rows !== rows) {
                    sessionClient.resize(id, term.cols, term.rows);
                }
            }, RESIZE_DEBOUNCE_MS);
        });
        observer.observe(host);

        // Selecting copies; the platform's paste shortcut lands in xterm's own textarea.
        const copySelection = (): void => {
            if (term.hasSelection()) {
                void navigator.clipboard?.writeText(term.getSelection()).catch(() => undefined);
            }
        };
        host.addEventListener('pointerup', copySelection);

        return () => {
            cancelled = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            observer.disconnect();
            host.removeEventListener('pointerup', copySelection);
            offOutput();
            offScreen();
            unregister();
            void sessionClient.detach(id);
            term.dispose();
            termRef.current = null;
        };
    }, [id, generation]);

    useEffect(() => {
        const term = termRef.current;
        if (!term) {
            return;
        }
        if (focused) {
            term.focus();
        } else {
            term.blur();
        }
    }, [focused, generation]);

    useEffect(() => {
        const term = termRef.current;
        if (term) {
            term.options.theme = readTerminalTheme();
        }
    }, [resolvedTheme, generation]);

    const rebuild = (): void => {
        setFailure(null);
        setGeneration((g) => g + 1);
    };

    const restart = async (): Promise<void> => {
        try {
            await sessionClient.kill(id);
        } catch {
            // Already gone on the daemon; creating it again is all that matters.
        }
        rebuild();
    };

    return (
        <div className="absolute inset-0 bg-term-bg">
            <div ref={hostRef} className="term-host" />
            {status !== 'open' && (
                <div className="pointer-events-none absolute inset-x-3 top-3 z-10 rounded-lg border border-border bg-surface-raised/90 px-3 py-2 text-[12px] text-text-muted">
                    {status === 'closed' ? (
                        <>Not connected to the Ruimte server. Run <code className="font-mono text-text">bun run dev:server</code>.</>
                    ) : (
                        'Connecting to the Ruimte server'
                    )}
                </div>
            )}
            {failure && (
                <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-3 rounded-lg border border-border bg-surface-raised/90 px-3 py-2 text-[12px] text-status-error">
                    <span className="grow">{failure}</span>
                    <button className="icon-btn h-7 w-7 shrink-0" title="Try again" onClick={rebuild}>
                        <RotateCw size={13} />
                    </button>
                </div>
            )}
            {exited !== undefined && (
                <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-border bg-surface-raised/90 px-3 py-1.5 font-mono text-[12px] text-term-dim">
                    <span className="grow">[process exited with code {exited}]</span>
                    <button
                        className="inline-flex h-6 items-center gap-1.5 rounded-md bg-surface-sunken px-2 font-sans text-[11px] font-medium text-text hover:bg-border"
                        onClick={() => void restart()}
                    >
                        <RotateCw size={12} /> Restart
                    </button>
                </div>
            )}
        </div>
    );
}
