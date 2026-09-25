import { TerminalDictation } from '@/dictation/TerminalDictation';
import { clearTerminalAction, restartTerminalAction, resumeTerminalAgentAction } from '@/actions/client-actions';
import { useEffect, useRef, useState } from 'react';
import i18next from 'i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import clsx from 'clsx';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { ClipboardPaste, Copy, Play, RotateCw, Scan } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEndpointId } from '@/state/keys';
import { useSessionRestarts, useSessionRow } from '@/state/sessions';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';
import { isApplePlatform } from '@/desktop/bridge';
import { sessionClient } from '@/terminal';
import { isAppShortcut, isClearShortcut, isLeaveNodeShortcut, macMotionSequence } from '@/terminal/keymap';
import { lastScreenOf, registerTerminal } from '@/terminal/registry';
import { readTerminalFont, readTerminalTheme } from '@/terminal/theme';
import { webglBudget } from '@/terminal/webgl-budget';
import { useTransportStatus } from '@/transport/status';
import { NodeNotice } from '@/nodes/NodeNotice';
import { closeHost, readNodeHost, useSuggestedTitle } from '@/nodes/node-host';
import { Button } from '@/ui/Button';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText, readClipboardText } from '@/ui/clipboard';
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

/*
 * FitAddon measures the host's border box, so a vertical padding on the host would count as room for a
 * row that is cut off. The host has none; what a whole row does not fill is split above and below, as an
 * offset rather than a padding, since FitAddon subtracts the terminal element's own padding too.
 */
const fitToHost = (term: Terminal, fit: FitAddon): void => {
    fit.fit();
    const host = term.element?.parentElement;
    // The same private dimensions FitAddon itself divides by.
    const cellHeight: number = (term as unknown as { _core: { _renderService: { dimensions: { css: { cell: { height: number } } } } } })._core._renderService
        .dimensions.css.cell.height;
    if (!host || cellHeight === 0) {
        return;
    }
    const slack = host.clientHeight - term.rows * cellHeight;
    host.style.setProperty('--term-offset', `${Math.max(0, Math.floor(slack / 2))}px`);
};

/* What the placeholder for an offscreen terminal shows: the text of its last screen. */
export function TerminalPlate({ id }: { id: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const endpointId = useEndpointId();
    // Filled from a passive effect, not during render: the live node captures its screen in its own
    // passive cleanup, which React runs earlier in the same flush.
    useEffect(() => {
        if (ref.current) {
            ref.current.textContent = lastScreenOf(endpointId, id).join('\n');
        }
    }, [endpointId, id]);
    return (
        <div
            ref={ref}
            className="term-host overflow-hidden whitespace-pre pt-1.5 bg-term-bg font-mono text-code leading-[1.2] text-term-dim"
            aria-hidden="true"
        />
    );
}

/* The body of a terminal, the same on a canvas inside a frame and filling a view of its own. */
export function TerminalBody({ id, focused }: { id: string; focused: boolean }) {
    const { t } = useTranslation(['canvas', 'common']);
    const hostRef = useRef<HTMLDivElement>(null);
    const dictationRoot = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const refitRef = useRef<(() => void) | null>(null);
    /* Bumped by a retry after a failure; a restart through the actions counts in the sessions store. */
    const [generation, setGeneration] = useState(0);
    // Either one rebuilds the whole terminal around a fresh session, and both only ever go up.
    const builds = generation + useSessionRestarts(id);
    const [failure, setFailure] = useState<string | null>(null);
    // Whether the terminal had a selection when its menu opened, which is what Copy goes on.
    const [selected, setSelected] = useState(false);
    const status = useTransportStatus();
    const endpointId = useEndpointId();
    const exited = useSessionRow(id, (row) => row?.exited);
    const agentRecord = useSessionRow(id, (row) => row?.agent);
    const heldCommand = useSessionRow(id, (row) => row?.heldCommand);
    // Claude Code and Codex write a name down; the daemon sends none for Gemini or Copilot.
    useSuggestedTitle(id, agentRecord?.kind === 'claude' || agentRecord?.kind === 'codex' ? agentRecord.suggestedTitle : undefined);
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
        fitToHost(term, fit);
        termRef.current = term;

        /*
         * The grid this node fits and asks the PTY for, and the grid the PTY has. They part while a client
         * elsewhere types into the same terminal; this one then draws that grid, clipped or with room to
         * spare, until a key or a resize here makes it the active one again.
         */
        let claimed = { cols: term.cols, rows: term.rows };
        let shared = claimed;
        const drawShared = (): void => {
            if (term.cols !== shared.cols || term.rows !== shared.rows) {
                term.resize(shared.cols, shared.rows);
            }
        };
        // A node resize, a font change and the renderer swaps of the WebGL budget all land here: WebGL and
        // the DOM measure a glyph differently, so a swap can change how many cells fit.
        const refit = (): void => {
            fitToHost(term, fit);
            if (term.cols !== claimed.cols || term.rows !== claimed.rows) {
                claimed = { cols: term.cols, rows: term.rows };
                shared = claimed;
                sessionClient.resize(id, claimed.cols, claimed.rows);
            }
            drawShared();
        };
        refitRef.current = refit;
        const releaseWebgl = webglBudget.register(id, term, refit);

        term.attachCustomKeyEventHandler((e) => {
            const apple = isApplePlatform();
            if (e.key === 'Escape') {
                // Escape is the program's (an interrupt, a mode change); only the leave shortcut returns
                // to the canvas, and it does so by falling through to the window listener unwritten.
                if (isLeaveNodeShortcut(e, apple)) {
                    return false;
                }
                // The canvas listens on window, where any Escape would clear the selection.
                e.stopPropagation();
                return true;
            }
            // A focused terminal has the keyboard the way a native one does: every shortcut the app does
            // not need to move between views stops here instead of reaching the window listeners. The
            // ones it does need are the window's alone, or xterm would write Cmd+Shift+Enter as a return.
            if (isAppShortcut(e, apple)) {
                return false;
            }
            e.stopPropagation();
            if (e.type !== 'keydown') {
                return true;
            }
            if (isClearShortcut(e, apple)) {
                e.preventDefault();
                clearTerminalAction(id);
                return false;
            }
            if (apple) {
                const motion = macMotionSequence(e, term.modes.applicationCursorKeysMode);
                if (motion) {
                    e.preventDefault();
                    sessionClient.write(id, motion);
                    return false;
                }
            }
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                sessionClient.write(id, SHIFT_ENTER);
                return false;
            }
            return true;
        });
        term.onData((data) => sessionClient.write(id, data));

        let cancelled = false;
        const unregister = registerTerminal(endpointId, id, term);
        const offOutput = sessionClient.onOutput(id, (data) => {
            term.write(data);
            // A terminal that is being written to outranks an idle one when contexts are scarce.
            webglBudget.touch(id);
        });
        const offSize = sessionClient.onSize(id, (size) => {
            shared = size;
            drawShared();
        });
        const offScreen = sessionClient.onScreen(id, ({ screen }) => {
            // A reset through the parser (RIS), since `term.reset()` runs at once and output still queued would land on the fresh screen.
            term.write(`\x1bc${screen}`);
        });

        const spec = readNodeHost(id);
        // A terminal without its own directory starts in the project folder, like one opened from the repo.
        const cwd = spec?.cwd ?? useProject.getState().current?.folder ?? undefined;
        // An agent says which CLI and how; the daemon turns that into the line the shell gets.
        const agent = spec?.provider ? { kind: spec.provider, runtimeMode: spec.runtimeMode, resume: spec.resume } : undefined;
        sessionClient
            .open(id, { cwd, command: spec?.command, agent }, term.cols, term.rows)
            .then((result) => {
                if (!cancelled && result) {
                    shared = { cols: result.cols, rows: result.rows };
                    drawShared();
                    term.write(result.screen);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    // Not the hook's `t`: the effect would then depend on it and rebuild the terminal on a language change.
                    setFailure(e instanceof Error ? e.message : i18next.t('canvas:terminal.startFailed'));
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
            offSize();
            offScreen();
            unregister();
            releaseWebgl();
            void sessionClient.detach(id);
            term.dispose();
            termRef.current = null;
            refitRef.current = null;
        };
    }, [endpointId, id, builds]);

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
    }, [id, focused, builds]);

    useEffect(() => {
        const term = termRef.current;
        if (!term) {
            return;
        }
        term.options.theme = readTerminalTheme();
        term.options.fontFamily = readTerminalFont();
        term.options.fontSize = useSettings.getState().fontSize;
        // A new glyph size changes how many cells fit; the observer only fires on a host resize.
        refitRef.current?.();
    }, [id, resolvedTheme, settingsVersion, builds]);

    const rebuild = (): void => {
        setFailure(null);
        setGeneration((g) => g + 1);
    };

    // The shell is gone but the CLI's session is not: the daemon kept the id its own resume takes.
    const resumable = exited !== undefined && agentRecord?.status === 'exited';

    const close = (): void => closeHost(id);

    const paste = async (): Promise<void> => {
        const text = await readClipboardText();
        if (text !== '') {
            termRef.current?.paste(text);
        }
    };

    return (
        <ContextMenu.Root onOpenChange={(open) => setSelected(open && (termRef.current?.hasSelection() ?? false))}>
            <ContextMenu.Trigger className="absolute inset-0 bg-term-bg">
                <div ref={dictationRoot} className="absolute inset-0 flex min-h-0 flex-col">
                    <div className="relative min-h-0 flex-1">
                        <div ref={hostRef} className="term-host" />
                        {status !== 'open' && <NodeNotice>{status === 'closed' ? t('notice.reconnecting') : t('notice.connecting')}</NodeNotice>}
                        {failure && (
                            <NodeNotice tone="error" onRetry={rebuild}>
                                {failure}
                            </NodeNotice>
                        )}
                        {heldCommand !== undefined && exited === undefined && (
                            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t border-border bg-surface-raised/90 px-3 py-1.5 font-mono text-xs text-text">
                                <span className="grow truncate">{t('terminal.held', { command: heldCommand })}</span>
                                <Button size="sm" onClick={() => void sessionClient.runHeld(id).catch(() => undefined)}>
                                    <Icon icon={Play} size={12} /> {t('terminal.run')}
                                </Button>
                            </div>
                        )}
                        {exited !== undefined && (
                            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t border-border bg-surface-raised/90 px-3 py-1.5 font-mono text-xs text-term-dim">
                                {/* A shell that ended on its own reads as a footnote; a non-zero code is news. */}
                                {resumable ? (
                                    <span className="grow">{t('terminal.sessionEnded')}</span>
                                ) : (
                                    <span className={clsx('grow', exited !== 0 && 'text-status-error')}>{t('terminal.exited', { code: exited })}</span>
                                )}
                                {resumable && (
                                    <Button size="sm" onClick={() => resumeTerminalAgentAction(id)}>
                                        <Icon icon={Play} size={12} /> {t('terminal.resume')}
                                    </Button>
                                )}
                                <Button size="sm" variant="secondary" onClick={() => restartTerminalAction(id)}>
                                    <Icon icon={RotateCw} size={12} /> {t('terminal.restart')}
                                </Button>
                                <Button size="sm" onClick={close}>
                                    {t('common:action.close')}
                                </Button>
                            </div>
                        )}
                    </div>
                    <TerminalDictation
                        terminalId={id}
                        key={builds}
                        targetRef={dictationRoot}
                        disabled={status !== 'open' || exited !== undefined || failure !== null}
                        paste={(text) => {
                            termRef.current?.paste(text);
                            termRef.current?.focus();
                        }}
                    />
                </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        {/* xterm keeps its selection to itself, so this asks the terminal instead of the document. */}
                        <ContextMenu.Item className="menu-item" disabled={!selected} onClick={() => copyText(termRef.current?.getSelection() ?? '')}>
                            <Icon icon={Copy} size={14} /> {t('common:action.copy')}
                        </ContextMenu.Item>
                        <ContextMenu.Item className="menu-item" onClick={() => void paste()}>
                            <Icon icon={ClipboardPaste} size={14} /> {t('edit.paste')}
                        </ContextMenu.Item>
                        <ContextMenu.Separator className={MENU_SEPARATOR} />
                        <ContextMenu.Item className="menu-item" onClick={() => termRef.current?.selectAll()}>
                            <Icon icon={Scan} size={14} /> {t('common:action.selectAll')}
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}
