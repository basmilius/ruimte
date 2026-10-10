import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { TerminalViewHandle } from '@adecore/terminal';
import { MachineTerminal } from '@/terminal/MachineTerminal';
import { ChevronDown, ExternalLink, Play, Plus, Rocket } from 'lucide-react';
import { Button, ButtonGroup, Icon, Menu, PanelEmpty, useNow } from '@adecore/ui';
import { formatAgo, formatDuration } from '@adecore/ui/format';
import { isApplePlatform } from '@/desktop/bridge';
import { openLaunchAddress, startLaunch } from '@/launches/actions';
import { LaunchMenu } from '@/launches/LaunchChip';
import { LaunchButtons, LaunchStatusIcon } from '@/launches/LaunchControls';
import { chosenLaunch, othersOf, outputOf, shortAddress, type LaunchView } from '@/launches/model';
import { useAddressReachable, useLaunches, useProjectLaunches } from '@/launches/state';
import { NodeNotice } from '@/nodes/NodeNotice';
import { PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { useProjectRepos } from '@/state/git-repos';
import { useEndpointId } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { isAppShortcut, isTerminalPaste, macMotionSequence } from '@/terminal/keymap';
import { sessionClientFor } from '@/transport/connections';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* What the picker says after the name: how long it runs and where, or how it ended. */
function pickerDetail(view: LaunchView, now: number, t: Translate): string {
    const { phase, status } = view;
    if (phase === 'held') {
        return t('phase.held');
    }
    if (status === null) {
        return '';
    }
    const ran = (status.endedAt ?? now) - status.startedAt;
    if (phase === 'starting' || phase === 'stopping') {
        return [t(`phase.${phase}`), formatDuration(ran)].join(' · ');
    }
    if (phase === 'running') {
        return [formatDuration(ran), ...(view.port === null ? [] : [`:${view.port}`])].join(' · ');
    }
    if (phase === 'passed' || phase === 'failed') {
        return [phase === 'passed' ? t('phase.passed') : t('exit', { code: status.exitCode ?? '?' }), formatDuration(ran)].join(' · ');
    }
    return status.endedAt === null ? '' : t('ended', { outcome: t('panel.stopped'), ago: formatAgo(now - status.endedAt) });
}

/*
 * The launches of the project on screen, and the terminal of the chosen one. The terminal is the
 * daemon's session for that launch, followed and never created here, so its screen outlives the
 * process until the next start.
 */
export function LaunchesPanel() {
    const { t } = useTranslation('launches');
    const { key, document, views } = useProjectLaunches();
    const chosenId = useUi((s) => (key === null ? undefined : s.chosenLaunches[key]));

    if (document === null) {
        return <PanelEmpty busy>{t('panel.reading')}</PanelEmpty>;
    }
    if (document.launches.length === 0) {
        return (
            <PanelEmpty
                icon={Rocket}
                action={
                    <Button size="sm" variant="secondary" onClick={() => useLaunches.getState().setDialog({ kind: 'edit', launchId: null })}>
                        <Icon icon={Plus} size={14} /> {t('menu.new')}
                    </Button>
                }
            >
                {t('panel.empty')}
            </PanelEmpty>
        );
    }

    const chosen = chosenLaunch(document, chosenId);
    const view = chosen === null ? null : (views.get(chosen.id) ?? null);
    const output = chosen === null ? null : outputOf(views, chosen);

    return (
        <div className="flex min-h-0 grow flex-col">
            {view !== null && <LaunchPicker view={view} />}
            {output === null ? null : <LaunchOutput view={output} />}
        </div>
    );
}

/* The chosen launch with its buttons, in the panel's header; the others are one click away in the same menu as the chip's. */
function LaunchPicker({ view }: { view: LaunchView }) {
    const { t } = useTranslation('launches');
    const now = useNow(1_000);
    const { folder, views } = useProjectLaunches();
    const { repos } = useProjectRepos(folder);
    const others = useMemo(() => othersOf(views, view.launch), [views, view.launch]);
    const detail = pickerDetail(view, now, t);

    return (
        <PanelHeaderSlot>
            <Menu.Root>
                <Menu.Trigger
                    aria-label={t('menu.open')}
                    className="flex h-7 min-w-0 items-center gap-1.5 rounded-md pr-1.5 pl-2 text-left text-xs hover:bg-surface-hover data-[popup-open]:bg-surface-active"
                >
                    <LaunchStatusIcon view={view} size={14} />
                    <span className="min-w-0 truncate text-text">{view.launch.name}</span>
                    {detail !== '' && <span className="min-w-0 shrink-[4] truncate text-text-faint">{detail}</span>}
                    {others.count > 0 && (
                        <span
                            className={clsx('shrink-0 rounded-sm bg-surface-active px-1 tabular-nums', others.failed ? 'text-status-error' : 'text-text-muted')}
                        >
                            {t('others', { count: others.count })}
                        </span>
                    )}
                    <Icon icon={ChevronDown} size={12} className="shrink-0 text-text-faint" />
                </Menu.Trigger>
                <Menu.Popup className="min-w-72">
                    <LaunchMenu repos={repos} showOutput={false} />
                </Menu.Popup>
            </Menu.Root>
            <ButtonGroup className="ml-auto shrink-0">
                <LaunchButtons view={view} size="xs" />
            </ButtonGroup>
        </PanelHeaderSlot>
    );
}

/* The line above the output: where the command runs, what it is, and the address it answers on. */
function LaunchOutput({ view }: { view: LaunchView }) {
    const { t } = useTranslation('launches');
    const reachable = useAddressReachable();
    const { launch, status } = view;
    const address = view.phase === 'running' && launch.url !== undefined ? launch.url : null;

    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 font-mono text-xs text-text-faint">
                {launch.cwd !== undefined && launch.cwd !== '' && <span className="shrink-0">{launch.cwd}</span>}
                <span className="shrink-0">$</span>
                <span className="min-w-0 grow truncate text-text-muted">{launch.command}</span>
                {address !== null &&
                    (reachable ? (
                        <button
                            type="button"
                            className="flex shrink-0 items-center gap-1 text-accent hover:underline"
                            onClick={() => openLaunchAddress(address)}
                        >
                            {shortAddress(address)}
                            <Icon icon={ExternalLink} size={12} />
                        </button>
                    ) : (
                        <span className="shrink-0">{shortAddress(address)}</span>
                    ))}
            </div>
            {status === null ? (
                <PanelEmpty
                    icon={Play}
                    action={
                        view.phase === 'held' ? undefined : (
                            <Button size="sm" variant="secondary" onClick={() => void startLaunch(launch.id)}>
                                <Icon icon={Play} size={14} /> {t('start', { name: launch.name })}
                            </Button>
                        )
                    }
                >
                    {t('panel.notRun', { name: launch.name })}
                </PanelEmpty>
            ) : (
                // A start makes a fresh session under the same id, so a new start time mounts a fresh terminal.
                <LaunchTerminal key={`${status.sessionId}:${status.startedAt}`} sessionId={status.sessionId} />
            )}
        </div>
    );
}

function LaunchTerminal({ sessionId }: { sessionId: string }) {
    const viewRef = useRef<TerminalViewHandle>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const fontSize = useSettings((s) => s.fontSize);
    const lineHeight = useSettings((s) => s.terminalLineHeight);
    const endpointId = useEndpointId();
    // Taken once, so a panel that closes after the window moved to another machine still detaches from its own.
    const [sessions] = useState(() => sessionClientFor(endpointId));

    useEffect(() => {
        const view = viewRef.current;
        const term = view?.terminal;
        if (!view || !term || !sessions) {
            return;
        }

        // Typing reaches the launch, since some dev servers listen for a key; the app keeps the shortcuts it moves between views with.
        term.attachCustomKeyEventHandler((e) => {
            const apple = isApplePlatform();
            if (isAppShortcut(e, apple)) {
                return false;
            }
            e.stopPropagation();
            if (e.type !== 'keydown') {
                return true;
            }
            // Neither written nor prevented, so the browser's own paste lands in xterm's textarea.
            if (isTerminalPaste(e, apple)) {
                return false;
            }
            const motion = apple ? macMotionSequence(e, term.modes.applicationCursorKeysMode) : null;
            if (motion) {
                e.preventDefault();
                sessions.write(sessionId, motion);
                return false;
            }
            return true;
        });

        let cancelled = false;
        const offOutput = sessions.onOutput(sessionId, (data) => view.write(data));
        // The grid of another window that reads the same launch, until a resize here claims it back.
        const offSize = sessions.onSize(sessionId, (size) => view.followGrid(size));
        const offScreen = sessions.onScreen(sessionId, ({ screen }) => {
            view.reset();
            view.write(screen);
        });
        const { cols, rows } = view.size();
        sessions
            .open(sessionId, { follow: true }, cols, rows)
            .then((result) => {
                if (!cancelled && result) {
                    view.followGrid({ cols: result.cols, rows: result.rows });
                    view.write(result.screen);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setFailure(e instanceof Error ? e.message : i18next.t('launches:panel.attachFailed'));
                }
            });

        return () => {
            cancelled = true;
            offOutput();
            offSize();
            offScreen();
            void sessions.detach(sessionId);
        };
    }, [sessions, sessionId]);

    return (
        <div className="relative min-h-0 grow bg-term-bg">
            {sessions && (
                <MachineTerminal
                    ref={viewRef}
                    endpointId={endpointId}
                    className="absolute inset-0"
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    onData={(data) => sessions.write(sessionId, data)}
                    onResize={(cols, rows) => sessions.resize(sessionId, cols, rows)}
                />
            )}
            {failure !== null && <NodeNotice tone="error">{failure}</NodeNotice>}
        </div>
    );
}
