import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { RotateCw } from 'lucide-react';
import { useCanvas } from '@/state/canvas';
import { useSessions } from '@/state/sessions';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';
import { isApplePlatform } from '@/desktop/bridge';
import { sessionClient } from '@/terminal';
import { isLeaveNodeChord, macMotionSequence } from '@/terminal/keymap';
import { lastScreenOf, registerTerminal } from '@/terminal/registry';
import { readTerminalFont, readTerminalTheme } from '@/terminal/theme';
import { webglBudget } from '@/terminal/webgl-budget';
import { useTransportStatus } from '@/transport/status';
import { NodeNotice } from '@/canvas/nodes/NodeNotice';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

const RESIZE_DEBOUNCE_MS = 50;
/* ESC CR: what agent CLIs read as "newline, do not submit". Harmless in a plain shell. */
const SHIFT_ENTER = '\x1b\r';

const createTerminal = (): Terminal =>
    new Terminal({
        theme: readTerminalTheme(),
        fontFamily: readTerminalFont(),
        fontSize: useSettings.getState().fontSize,
        cursorBlink: true,
        scrollback: 5000,
        macOptionIsMeta: true
    });

/* What the placeholder for an offscreen terminal shows: the text of its last screen. */
export function TerminalPlate({ id }: { id: string }) {
    const ref = useRef<HTMLDivElement>(null);
    // Filled from a passive effect, not during render: the live node captures its screen in its own
    // passive cleanup, which React runs earlier in the same flush.
    useEffect(() => {
        if (ref.current) {
            ref.current.textContent = lastScreenOf(id).join('\n');
        }
    }, [id]);
    return <div ref={ref} className="term-host overflow-hidden whitespace-pre bg-term-bg font-mono text-code leading-[1.2] text-term-dim" aria-hidden="true" />;
}

export function TerminalNode({ id, focused }: { id: string; focused: boolean }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    /* Bumped by Restart: the whole terminal is rebuilt around a fresh session. */
    const [generation, setGeneration] = useState(0);
    const [failure, setFailure] = useState<string | null>(null);
    const status = useTransportStatus();
    const exited = useSessions((s) => s.byNodeId[id]?.exited);
    const resolvedTheme = useTheme((t) => t.resolved);
    const settingsVersion = useSettings((s) => s.version);

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
        fit.fit();
        termRef.current = term;
        fitRef.current = fit;

        // A node resize and the renderer swaps of the WebGL budget both land here: WebGL and the
        // DOM measure a glyph differently, so a swap can change how many cells fit.
        const refit = (): void => {
            const { cols, rows } = term;
            fit.fit();
            if (term.cols !== cols || term.rows !== rows) {
                sessionClient.resize(id, term.cols, term.rows);
            }
        };
        const releaseWebgl = webglBudget.register(id, term, refit);

        term.attachCustomKeyEventHandler((e) => {
            if (e.key === 'Escape') {
                // Escape is the program's (an interrupt, a mode change); only the leave chord returns
                // to the canvas, and it does so by falling through to the window listener unwritten.
                if (isLeaveNodeChord(e, isApplePlatform())) {
                    return false;
                }
                // The canvas listens on window, where any Escape would end node mode.
                e.stopPropagation();
                return true;
            }
            if (e.type === 'keydown' && isApplePlatform()) {
                const motion = macMotionSequence(e, term.modes.applicationCursorKeysMode);
                if (motion) {
                    e.preventDefault();
                    // A Cmd chord is the canvas's by default; this one belongs to the shell.
                    e.stopPropagation();
                    sessionClient.write(id, motion);
                    return false;
                }
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
        const offOutput = sessionClient.onOutput(id, (data) => {
            term.write(data);
            // A terminal that is being written to outranks an idle one when contexts are scarce.
            webglBudget.touch(id);
        });
        const offScreen = sessionClient.onScreen(id, ({ screen }) => {
            term.reset();
            term.write(screen);
        });

        const node = useCanvas.getState().nodes[id];
        // A node without its own directory starts in the project folder, like a terminal opened from the repo.
        const cwd = node?.cwd ?? useProject.getState().current?.folder ?? undefined;
        // An agent node says which CLI and how; the daemon turns that into the line the shell gets.
        const agent = node?.provider ? { kind: node.provider, runtimeMode: node.runtimeMode, resume: node.resume } : undefined;
        sessionClient
            .open(id, { cwd, command: node?.command, agent }, term.cols, term.rows)
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
                refit();
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
            releaseWebgl();
            void sessionClient.detach(id);
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
        };
    }, [id, generation]);

    useEffect(() => {
        const term = termRef.current;
        if (!term) {
            return;
        }
        if (focused) {
            term.focus();
            webglBudget.focus(id);
        } else {
            term.blur();
            webglBudget.blur(id);
        }
    }, [id, focused, generation]);

    useEffect(() => {
        const term = termRef.current;
        if (!term) {
            return;
        }
        term.options.theme = readTerminalTheme();
        term.options.fontFamily = readTerminalFont();
        term.options.fontSize = useSettings.getState().fontSize;
        // A new glyph size changes how many cells fit; the observer only fires on a host resize.
        const { cols, rows } = term;
        fitRef.current?.fit();
        if (term.cols !== cols || term.rows !== rows) {
            sessionClient.resize(id, term.cols, term.rows);
        }
    }, [id, resolvedTheme, settingsVersion, generation]);

    const rebuild = (): void => {
        setFailure(null);
        setGeneration((g) => g + 1);
    };

    const close = (): void => {
        const canvas = useCanvas.getState();
        canvas.select([id]);
        canvas.deleteSelected();
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
                <NodeNotice>
                    {status === 'closed' ? (
                        <>
                            Not connected to the Ruimte server. Run <code className="font-mono text-text">bun run dev:server</code>.
                        </>
                    ) : (
                        'Connecting to the Ruimte server'
                    )}
                </NodeNotice>
            )}
            {failure && (
                <NodeNotice tone="error" onRetry={rebuild}>
                    {failure}
                </NodeNotice>
            )}
            {exited !== undefined && (
                <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t border-border bg-surface-raised/90 px-3 py-1.5 font-mono text-xs text-term-dim">
                    {/* A shell that ended on its own reads as a footnote; a non-zero code is news. */}
                    <span className={clsx('grow', exited !== 0 && 'text-status-error')}>[process exited with code {exited}]</span>
                    <Button size="sm" variant="secondary" onClick={() => void restart()}>
                        <Icon icon={RotateCw} size={12} /> Restart
                    </Button>
                    <Button size="sm" onClick={close}>
                        Close node
                    </Button>
                </div>
            )}
        </div>
    );
}
