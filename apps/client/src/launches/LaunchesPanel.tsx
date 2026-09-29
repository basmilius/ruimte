import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Terminal } from '@xterm/xterm';
import { Play, Plus, Rocket } from 'lucide-react';
import type { LaunchConfigEntry } from '@ruimte/contracts';
import { Button, ButtonGroup, Icon, PanelEmpty, useNow } from '@basmilius/react-ui';
import { formatAgo, formatDuration } from '@basmilius/react-ui/format';
import { isApplePlatform } from '@/desktop/bridge';
import { chooseLaunch, openLaunchAddress, startLaunch } from '@/launches/actions';
import { LaunchButtons, LaunchDot } from '@/launches/LaunchControls';
import { chosenLaunch, outputOf, shortAddress, type LaunchView } from '@/launches/model';
import { useAddressReachable, useLaunches, useProjectLaunches } from '@/launches/state';
import { NodeNotice } from '@/nodes/NodeNotice';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';
import { useUi } from '@/state/ui';
import { sessionClient } from '@/terminal';
import { isAppShortcut, isTerminalPaste, macMotionSequence } from '@/terminal/keymap';
import { readTerminalFont, readTerminalTheme } from '@/terminal/theme';
import { createTerminal, fitToHost } from '@/terminal/xterm';

const RESIZE_DEBOUNCE_MS = 50;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* What a row says after the name: how long it runs and where, or how it ended. */
const rowDetail = (view: LaunchView, all: readonly LaunchConfigEntry[], now: number, t: Translate): string => {
    const { launch, phase, status } = view;
    if (phase === 'held') {
        return t('phase.held');
    }
    if (status === null) {
        return launch.kind === 'group' ? (launch.launches ?? []).flatMap((id) => all.find((candidate) => candidate.id === id)?.name ?? []).join(' + ') : '';
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
};

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
    const output = chosen === null ? null : outputOf(views, chosen);

    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border py-1">
                {document.launches.map((launch) => {
                    const view = views.get(launch.id);
                    return view === undefined ? null : (
                        <LaunchListRow key={launch.id} view={view} all={document.launches} selected={launch.id === chosen?.id} />
                    );
                })}
            </div>
            {output === null ? null : <LaunchOutput view={output} />}
        </div>
    );
}

function LaunchListRow({ view, all, selected }: { view: LaunchView; all: readonly LaunchConfigEntry[]; selected: boolean }) {
    const { t } = useTranslation('launches');
    const now = useNow(1_000);
    const { launch } = view;
    const detail = rowDetail(view, all, now, t);

    return (
        <div
            data-selected={selected || undefined}
            className="group flex h-8 min-w-0 items-center gap-1 pr-1 text-xs hover:bg-surface-hover data-[selected]:bg-surface-active"
        >
            <button
                type="button"
                aria-current={selected}
                className="flex h-full min-w-0 grow items-center gap-2 pl-3 text-left"
                onClick={() => chooseLaunch(launch.id)}
            >
                <LaunchDot view={view} />
                <span className="min-w-0 truncate text-text">{launch.name}</span>
                <span className={clsx('min-w-0 truncate', view.phase === 'held' ? 'text-status-needs-you' : 'text-text-faint')}>{detail}</span>
            </button>
            <ButtonGroup className="shrink-0">
                <LaunchButtons view={view} />
            </ButtonGroup>
        </div>
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
                            className="shrink-0 underline-offset-2 hover:text-text hover:underline"
                            onClick={() => openLaunchAddress(address)}
                        >
                            {shortAddress(address)}
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
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const refitRef = useRef<(() => void) | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const resolvedTheme = useTheme((s) => s.resolved);
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

        // The grid this panel asks for and the one the PTY has, which part while another window reads the same launch.
        let claimed = { cols: term.cols, rows: term.rows };
        let shared = claimed;
        const drawShared = (): void => {
            if (term.cols !== shared.cols || term.rows !== shared.rows) {
                term.resize(shared.cols, shared.rows);
            }
        };
        const refit = (): void => {
            fitToHost(term, fit);
            if (term.cols !== claimed.cols || term.rows !== claimed.rows) {
                claimed = { cols: term.cols, rows: term.rows };
                shared = claimed;
                sessionClient.resize(sessionId, claimed.cols, claimed.rows);
            }
            drawShared();
        };
        refitRef.current = refit;

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
                sessionClient.write(sessionId, motion);
                return false;
            }
            return true;
        });
        term.onData((data) => sessionClient.write(sessionId, data));

        let cancelled = false;
        const offOutput = sessionClient.onOutput(sessionId, (data) => term.write(data));
        const offSize = sessionClient.onSize(sessionId, (size) => {
            shared = size;
            drawShared();
        });
        const offScreen = sessionClient.onScreen(sessionId, ({ screen }) => term.write(`\x1bc${screen}`));
        sessionClient
            .open(sessionId, { follow: true }, term.cols, term.rows)
            .then((result) => {
                if (!cancelled && result) {
                    shared = { cols: result.cols, rows: result.rows };
                    drawShared();
                    term.write(result.screen);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setFailure(e instanceof Error ? e.message : i18next.t('launches:panel.attachFailed'));
                }
            });

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

        return () => {
            cancelled = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            observer.disconnect();
            offOutput();
            offSize();
            offScreen();
            void sessionClient.detach(sessionId);
            term.dispose();
            termRef.current = null;
            refitRef.current = null;
        };
    }, [sessionId]);

    useEffect(() => {
        const term = termRef.current;
        if (!term) {
            return;
        }
        term.options.theme = readTerminalTheme();
        term.options.fontFamily = readTerminalFont();
        term.options.fontSize = useSettings.getState().fontSize;
        refitRef.current?.();
    }, [resolvedTheme, settingsVersion]);

    return (
        <div className="relative min-h-0 grow bg-term-bg">
            <div ref={hostRef} className="term-host" />
            {failure !== null && <NodeNotice tone="error">{failure}</NodeNotice>}
        </div>
    );
}
