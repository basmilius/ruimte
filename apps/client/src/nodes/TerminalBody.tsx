import { openFileLink } from '@/shell/panels/file-links';
import type { TerminalFileLink } from '@/terminal/file-links';
import { TerminalDictation } from '@/dictation/TerminalDictation';
import { clearTerminalAction, restartTerminalAction, resumeTerminalAgentAction } from '@/actions/client-actions';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import i18next from 'i18next';
import clsx from 'clsx';
import type { TerminalViewHandle } from '@adecore/terminal';
import { MachineTerminal } from '@/terminal/MachineTerminal';
import { SessionPortMonitor } from '@/terminal/SessionPorts';
import { ClipboardPaste, Copy, Eye, Play, RotateCw, Scan } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEndpointId } from '@/state/keys';
import { useSessionRestarts, useSessionRow } from '@/state/sessions';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { osc52Text } from '@/terminal/osc52';
import { lastScreenOf, registerTerminal } from '@/terminal/registry';
import { bindTerminalKeys } from '@/terminal/xterm';
import { sessionClientFor } from '@/transport/connections';
import { useTransportStatus } from '@/transport/status';
import { NodeNotice } from '@/nodes/NodeNotice';
import { closeHost, readNodeHost, useSuggestedTitle } from '@/nodes/node-host';
import { Button, copyText, readClipboardText, Icon, ContextMenu, ErrorBoundary, prefetcher } from '@adecore/ui';

// A terminal loads the WebGL addon on its first context; prefetched, it is there by then.
prefetcher.register(() => import('@xterm/addon-webgl'));

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
            className="absolute inset-0 overflow-hidden whitespace-pre pt-1.5 pl-2 bg-term-bg font-mono text-code leading-[1.2] text-term-dim"
            aria-hidden="true"
        />
    );
}

/* The body of a terminal, the same on a canvas inside a frame and filling a view of its own. */
export function TerminalBody({ id, focused }: { id: string; focused: boolean }) {
    const { t } = useTranslation(['canvas', 'common']);
    const viewRef = useRef<TerminalViewHandle>(null);
    const dictationRoot = useRef<HTMLDivElement>(null);
    /* Bumped by a retry after a failure; a restart through the actions counts in the sessions store. */
    const [generation, setGeneration] = useState(0);
    // Either one rebuilds the whole terminal around a fresh session, and both only ever go up.
    const builds = generation + useSessionRestarts(id);
    const [failure, setFailure] = useState<string | null>(null);
    // Whether the terminal had a selection when its menu opened, which is what Copy goes on.
    const [selected, setSelected] = useState(false);
    const fileHover = useRef<TerminalFileLink | null>(null);
    const [menuLink, setMenuLink] = useState<TerminalFileLink | null>(null);
    const onFileLinkHover = useCallback((link: TerminalFileLink | null) => {
        fileHover.current = link;
    }, []);
    const status = useTransportStatus();
    const endpointId = useEndpointId();
    const exited = useSessionRow(id, (row) => row?.exited);
    const attached = useSessionRow(id, (row) => row?.attached);
    const agentRecord = useSessionRow(id, (row) => row?.agent);
    const heldCommand = useSessionRow(id, (row) => row?.heldCommand);
    // Claude Code and Codex write a name down; the daemon sends none for Gemini or Copilot.
    useSuggestedTitle(id, agentRecord?.kind === 'claude' || agentRecord?.kind === 'codex' ? agentRecord.suggestedTitle : undefined);

    useEffect(() => {
        if (focused) {
            viewRef.current?.focus();
        } else {
            viewRef.current?.blur();
        }
    }, [endpointId, id, focused, builds]);

    const rebuild = (): void => {
        setFailure(null);
        setGeneration((g) => g + 1);
    };

    const paste = async (): Promise<void> => {
        const text = await readClipboardText();
        if (text !== '') {
            viewRef.current?.paste(text);
        }
    };

    return (
        <ContextMenu.Root
            onOpenChange={(open) => {
                setSelected(open && (viewRef.current?.selection() ?? '') !== '');
                if (open) {
                    setMenuLink(fileHover.current);
                }
            }}
        >
            <ContextMenu.Trigger className="absolute inset-0 bg-term-bg">
                <div ref={dictationRoot} className="absolute inset-0 flex min-h-0 flex-col">
                    <div className="relative min-h-0 flex-1">
                        <TerminalSession
                            key={`${endpointId}:${id}:${builds}`}
                            id={id}
                            endpointId={endpointId}
                            viewRef={viewRef}
                            onFileLinkHover={onFileLinkHover}
                            onFailure={setFailure}
                        />
                        {status !== 'open' && <NodeNotice>{status === 'closed' ? t('notice.reconnecting') : t('notice.connecting')}</NodeNotice>}
                        {failure && (
                            <NodeNotice tone="error" onRetry={rebuild}>
                                {failure}
                            </NodeNotice>
                        )}
                        {heldCommand !== undefined && exited === undefined && <HeldCommandBar id={id} endpointId={endpointId} command={heldCommand} />}
                        {exited !== undefined && <ExitBar id={id} code={exited} resumable={agentRecord?.status === 'exited'} />}
                    </div>
                    {attached && exited === undefined && status === 'open' && (
                        <ErrorBoundary label={t('terminal.ports.label')} resetKeys={[endpointId, id, builds]} compact>
                            <SessionPortMonitor key={`${endpointId}:${id}:${builds}`} id={id} endpointId={endpointId} />
                        </ErrorBoundary>
                    )}
                    <TerminalDictation
                        terminalId={id}
                        key={builds}
                        targetRef={dictationRoot}
                        disabled={status !== 'open' || exited !== undefined || failure !== null}
                        paste={(text) => {
                            viewRef.current?.paste(text);
                            viewRef.current?.focus();
                        }}
                    />
                </div>
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                {menuLink !== null && (
                    <>
                        <ContextMenu.Item onClick={() => void openFileLink(null, menuLink.ref)}>
                            <Icon icon={Eye} size={14} /> {t('terminal.links.previewFile')}
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                    </>
                )}
                {/* xterm keeps its selection to itself, so this asks the terminal instead of the document. */}
                <ContextMenu.Item disabled={!selected} onClick={() => copyText(viewRef.current?.selection() ?? '')}>
                    <Icon icon={Copy} size={14} /> {t('common:action.copy')}
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => void paste()}>
                    <Icon icon={ClipboardPaste} size={14} /> {t('edit.paste')}
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={() => viewRef.current?.selectAll()}>
                    <Icon icon={Scan} size={14} /> {t('common:action.selectAll')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

const BAR = 'absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t border-border bg-surface-raised/90 px-3 py-1.5 font-mono text-xs';

function HeldCommandBar({ id, endpointId, command }: { id: string; endpointId: string; command: string }) {
    const { t } = useTranslation('canvas');
    return (
        <div className={clsx(BAR, 'text-text')}>
            <span className="grow truncate">{t('terminal.held', { command })}</span>
            <Button
                size="sm"
                onClick={() =>
                    void sessionClientFor(endpointId)
                        ?.runHeld(id)
                        .catch(() => undefined)
                }
            >
                <Icon icon={Play} size={12} /> {t('terminal.run')}
            </Button>
        </div>
    );
}

/* `resumable`: the shell is gone but the CLI's session is not, since the daemon kept the id its own resume takes. */
function ExitBar({ id, code, resumable }: { id: string; code: number; resumable: boolean }) {
    const { t } = useTranslation(['canvas', 'common']);
    return (
        <div className={clsx(BAR, 'text-term-dim')}>
            {/* A shell that ended on its own reads as a footnote; a non-zero code is news. */}
            {resumable ? (
                <span className="grow">{t('terminal.sessionEnded')}</span>
            ) : (
                <span className={clsx('grow', code !== 0 && 'text-status-error')}>{t('terminal.exited', { code })}</span>
            )}
            {resumable && (
                <Button size="sm" onClick={() => resumeTerminalAgentAction(id)}>
                    <Icon icon={Play} size={12} /> {t('terminal.resume')}
                </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => restartTerminalAction(id)}>
                <Icon icon={RotateCw} size={12} /> {t('terminal.restart')}
            </Button>
            <Button size="sm" onClick={() => closeHost(id)}>
                {t('common:action.close')}
            </Button>
        </div>
    );
}

interface TerminalSessionProps {
    id: string;
    endpointId: string;
    viewRef: RefObject<TerminalViewHandle | null>;
    onFileLinkHover(link: TerminalFileLink | null): void;
    onFailure(message: string): void;
}

/* The terminal and its session, keyed as one: React cleans a removed tree up from the top, so the screen is read before the terminal is disposed. */
function TerminalSession({ id, endpointId, viewRef, onFileLinkHover, onFailure }: TerminalSessionProps) {
    // Taken once, so a node that leaves after the window moved to another machine still detaches from its own.
    const [sessions] = useState(() => sessionClientFor(endpointId));
    const [spec] = useState(() => readNodeHost(id));
    const [cwd] = useState(() => spec?.cwd ?? useProject.getState().current?.folder ?? undefined);
    const fontSize = useSettings((s) => s.fontSize);
    const lineHeight = useSettings((s) => s.terminalLineHeight);

    useEffect(() => {
        const view = viewRef.current;
        const term = view?.terminal;
        if (!view || !term || !sessions) {
            return;
        }
        const element = term.element;
        // Every client attached to a session sees the sequence; only the node a person works in writes this machine's clipboard.
        term.parser.registerOscHandler(52, (data) => {
            const text = osc52Text(data);
            if (text !== null && document.hasFocus() && element?.contains(document.activeElement)) {
                copyText(text);
            }
            return true;
        });
        bindTerminalKeys(term, { write: (data) => sessions.write(id, data), clear: () => clearTerminalAction(id), leaves: true });

        let cancelled = false;
        const unregister = registerTerminal(endpointId, id, term);
        const offOutput = sessions.onOutput(id, (data) => view.write(data));
        // A client elsewhere that types into the same terminal sizes the PTY; this one draws that grid until a resize here claims it back.
        const offSize = sessions.onSize(id, (size) => view.followGrid(size));
        const offScreen = sessions.onScreen(id, ({ screen }) => {
            view.reset();
            view.write(screen);
        });

        // An agent says which CLI and how; the daemon turns that into the line the shell gets.
        const agent = spec?.provider ? { kind: spec.provider, runtimeMode: spec.runtimeMode, resume: spec.resume, account: spec.account } : undefined;
        const { cols, rows } = view.size();
        sessions
            .open(id, { cwd, command: spec?.command, agent }, cols, rows)
            .then((result) => {
                if (!cancelled && result) {
                    view.followGrid({ cols: result.cols, rows: result.rows });
                    view.write(result.screen);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    // Not the hook's `t`: the effect would then depend on it and rebuild the terminal on a language change.
                    onFailure(e instanceof Error ? e.message : i18next.t('canvas:terminal.startFailed'));
                }
            });

        // Selecting copies; the platform's paste shortcut lands in xterm's own textarea.
        const copySelection = (): void => {
            if (term.hasSelection()) {
                void navigator.clipboard?.writeText(term.getSelection()).catch(() => undefined);
            }
        };
        element?.addEventListener('pointerup', copySelection);

        return () => {
            cancelled = true;
            element?.removeEventListener('pointerup', copySelection);
            offOutput();
            offSize();
            offScreen();
            unregister();
            void sessions.detach(id);
        };
    }, [sessions, endpointId, id, viewRef, onFailure, spec, cwd]);

    if (!sessions) {
        return null;
    }
    // A camera zoom is a transform on an ancestor, so it never changes the grid: the body is sized in world units.
    return (
        <MachineTerminal
            ref={viewRef}
            endpointId={endpointId}
            sourceId={id}
            onFileLinkHover={onFileLinkHover}
            className="absolute inset-0"
            fontSize={fontSize}
            lineHeight={lineHeight}
            webgl
            scaledByAncestor
            onData={(data) => sessions.write(id, data)}
            onResize={(cols, rows) => sessions.resize(id, cols, rows)}
        />
    );
}
