import { useMemo, useRef } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Pencil, Play, Plus, Rocket, Search, SquareTerminal } from 'lucide-react';
import type { LaunchConfigEntry, LaunchesDocument } from '@ruimte/contracts';
import { Button, ButtonGroup, Icon, Menu, Popover, PromptDialog, useNow } from '@basmilius/react-ui';
import { formatAgo } from '@basmilius/react-ui/format';
import { chooseLaunch, chosenLaunchId, openLaunchAddress, showLaunchOutput, startLaunch } from '@/launches/actions';
import { LaunchButtons, LaunchDot } from '@/launches/LaunchControls';
import { foundText, newSuggestions } from '@/launches/editing';
import { chosenLaunch, launchSections, othersOf, shortAddress, type LaunchView } from '@/launches/model';
import { useAddressReachable, useLaunches, useLaunchSuggestions, useProjectLaunches } from '@/launches/state';
import { useProjectRepos } from '@/state/git-repos';
import { useUi } from '@/state/ui';

/* What the chip says after the name: the port it answers on, or why it is not running. */
const chipDetail = (view: LaunchView, t: (key: string, options?: Record<string, unknown>) => string): string | null => {
    switch (view.phase) {
        case 'held':
            return t('phase.held');
        case 'starting':
        case 'stopping':
        case 'passed':
            return t(`phase.${view.phase}`);
        case 'running':
            return view.port === null ? null : `:${view.port}`;
        case 'failed':
            return view.exitCode === null ? t('phase.failed') : t('exit', { code: view.exitCode });
        default:
            return null;
    }
};

/*
 * The launches of the project on screen: the one this client chose, with its state and the button
 * that starts or stops it, and a menu with all of them. It sits in the application's bar and not in
 * a view's, since a launch belongs to the project.
 */
export function LaunchChip() {
    const { t } = useTranslation('launches');
    const anchor = useRef<HTMLDivElement>(null);
    const { key, document, views } = useProjectLaunches();
    const chosenId = useUi((s) => (key === null ? undefined : s.chosenLaunches[key]));
    const pressed = useUi((s) => s.panel.open && s.panel.kind === 'launches');
    const ask = useLaunches((s) => s.ask);
    const chosen = document === null ? null : chosenLaunch(document, chosenId);
    const view = chosen === null ? null : (views.get(chosen.id) ?? null);
    const others = useMemo(() => othersOf(views, chosen), [views, chosen]);

    if (key === null) {
        return null;
    }

    const detail = view === null ? null : chipDetail(view, t);
    const askedName = ask === null ? '' : (document?.launches.find((launch) => launch.id === ask.launchId)?.name ?? '');
    const busyName = ask?.kind === 'busy' ? (document?.launches.find((launch) => launch.id === ask.busy.launchId)?.name ?? '') : '';

    return (
        <div
            ref={anchor}
            data-active={pressed ? 'true' : undefined}
            className="flex h-8 min-w-0 shrink items-center rounded-md border border-border bg-clip-padding data-[active=true]:bg-surface-active"
        >
            <Menu.Root>
                <Menu.Trigger
                    aria-label={t('menu.open')}
                    className="flex h-full min-w-0 shrink items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover data-[popup-open]:bg-surface-active"
                >
                    <Icon icon={Rocket} size={14} className="shrink-0" />
                    {view !== null && (
                        <>
                            <LaunchDot view={view} />
                            <span className="min-w-0 truncate text-text">{view.launch.name}</span>
                            {detail !== null && (
                                <span className={clsx('min-w-0 shrink-[4] truncate', view.phase === 'held' ? 'text-status-needs-you' : 'text-text-faint')}>
                                    {detail}
                                </span>
                            )}
                        </>
                    )}
                    {others.count > 0 && (
                        <span className={clsx('shrink-0', others.failed ? 'text-status-error' : 'text-text-faint')}>
                            {t('others', { count: others.count })}
                        </span>
                    )}
                </Menu.Trigger>
                <Menu.Popup className="min-w-72">
                    <LaunchMenu />
                </Menu.Popup>
            </Menu.Root>
            {view !== null && (
                <ButtonGroup className="shrink-0 pr-0.5">
                    <LaunchButtons view={view} chosen />
                </ButtonGroup>
            )}

            <Popover.Root
                open={ask?.kind === 'held'}
                onOpenChange={(open) => {
                    if (!open) {
                        useLaunches.getState().setAsk(null);
                    }
                }}
            >
                <Popover.Popup anchor={anchor} align="end" className="flex w-96 flex-col gap-2 p-3">
                    <Popover.Title className="font-medium text-text">{t('approve.title')}</Popover.Title>
                    <Popover.Description className="text-text-muted">{t('approve.description')}</Popover.Description>
                    {ask?.kind === 'held' &&
                        ask.held.map((held) => (
                            <code key={held.launchId} className="block rounded-md bg-surface-sunken px-2 py-1.5 font-mono break-all text-text">
                                <span className="text-text-faint">{held.cwd} $ </span>
                                {held.command}
                            </code>
                        ))}
                    <div className="flex justify-end gap-2 pt-1">
                        <Popover.Close render={<Button variant="secondary" size="sm" />}>{t('approve.cancel')}</Popover.Close>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                                if (ask?.kind === 'held') {
                                    useLaunches.getState().setAsk(null);
                                    void startLaunch(ask.launchId, { restart: ask.restart, approve: true, replace: ask.replace });
                                }
                            }}
                        >
                            {t('approve.confirm')}
                        </Button>
                    </div>
                </Popover.Popup>
            </Popover.Root>

            <PromptDialog
                open={ask?.kind === 'busy'}
                title={t('busy.title', { port: ask?.kind === 'busy' ? ask.busy.port : '' })}
                description={t('busy.description', { other: busyName, port: ask?.kind === 'busy' ? ask.busy.port : '', name: askedName })}
                confirmLabel={t('busy.confirm')}
                confirmIcon={Play}
                onConfirm={() => {
                    if (ask?.kind === 'busy') {
                        useLaunches.getState().setAsk(null);
                        void startLaunch(ask.launchId, { restart: ask.restart, approve: ask.approve, replace: true });
                    }
                }}
                onOpenChange={() => useLaunches.getState().setAsk(null)}
            />
        </div>
    );
}

/* Mounted while the menu is open, so the checkouts are only asked for then. */
function LaunchMenu() {
    const { t } = useTranslation('launches');
    const { document, folder, views } = useProjectLaunches();
    const { repos } = useProjectRepos(folder);
    const sections = useMemo(() => (document === null || folder === null ? [] : launchSections(document.launches, folder, repos)), [document, folder, repos]);

    return (
        <>
            {document !== null && document.launches.length === 0 && <FoundInProject document={document} />}
            {sections.map((section, index) => (
                <Menu.Group key={section.label ?? ''}>
                    {index > 0 && section.label === null && <Menu.Separator />}
                    {section.label !== null && <Menu.GroupLabel>{section.label}</Menu.GroupLabel>}
                    {section.launches.map((launch) => {
                        const view = views.get(launch.id);
                        return view === undefined ? null : <LaunchRow key={launch.id} view={view} document={document?.launches ?? []} />;
                    })}
                </Menu.Group>
            ))}
            {sections.length > 0 && <Menu.Separator />}
            {sections.length > 0 && (
                <Menu.Item onClick={() => showLaunchOutput()}>
                    <Icon icon={SquareTerminal} size={14} /> {t('showOutput')}
                </Menu.Item>
            )}
            <Menu.Item onClick={() => useLaunches.getState().setDialog({ kind: 'edit', launchId: null })}>
                <Icon icon={Plus} size={14} /> {t('menu.new')}
            </Menu.Item>
            {sections.length > 0 && (
                <Menu.Item onClick={() => useLaunches.getState().setDialog({ kind: 'edit', launchId: chosenLaunchId() })}>
                    <Icon icon={Pencil} size={14} /> {t('menu.edit')}
                </Menu.Item>
            )}
        </>
    );
}

/* A project without launches offers what the machine finds in it, so the first ones need no typing. */
function FoundInProject({ document }: { document: LaunchesDocument }) {
    const { t } = useTranslation('launches');
    const { projectId } = useProjectLaunches();
    const { suggestions } = useLaunchSuggestions(projectId);
    const text = useMemo(() => (suggestions === null ? null : foundText(newSuggestions(suggestions, document))), [suggestions, document]);

    if (suggestions !== null && text === null) {
        return null;
    }
    return (
        <>
            <Menu.Group>
                <Menu.GroupLabel>{t('found.title')}</Menu.GroupLabel>
                <p className="max-w-72 px-2 pb-1.5 text-xs text-text-muted">{text ?? t('found.searching')}</p>
                {text !== null && (
                    <Menu.Item onClick={() => useLaunches.getState().setDialog({ kind: 'import' })}>
                        <Icon icon={Search} size={14} /> {t('found.review')}
                    </Menu.Item>
                )}
            </Menu.Group>
            <Menu.Separator />
        </>
    );
}

/* What a row says beside the name when there is no address to follow. */
const rowHint = (view: LaunchView, all: readonly LaunchConfigEntry[], now: number, t: (key: string, options?: Record<string, unknown>) => string): string => {
    const { launch, phase, status } = view;
    if (phase === 'held') {
        return t('phase.held');
    }
    if ((phase === 'passed' || phase === 'failed') && status?.endedAt != null) {
        const outcome = phase === 'passed' ? t('phase.passed') : t('exit', { code: status.exitCode ?? '?' });
        return t('ended', { outcome, ago: formatAgo(now - status.endedAt) });
    }
    if (phase === 'starting' || phase === 'stopping') {
        return t(`phase.${phase}`);
    }
    if (launch.kind === 'group') {
        return (launch.launches ?? []).flatMap((id) => all.find((candidate) => candidate.id === id)?.name ?? []).join(' + ');
    }
    return launch.url === undefined ? (launch.command ?? '') : shortAddress(launch.url);
};

function LaunchRow({ view, document }: { view: LaunchView; document: readonly LaunchConfigEntry[] }) {
    const { t } = useTranslation('launches');
    const now = useNow(30_000);
    const { launch } = view;
    const reachable = useAddressReachable();
    const address = view.phase === 'running' && launch.url !== undefined ? launch.url : null;

    return (
        <div className="flex min-w-0 items-stretch" role="group">
            <Menu.Item className="min-w-0 flex-1" onClick={() => chooseLaunch(launch.id)}>
                <LaunchDot view={view} />
                <span className="min-w-0 truncate">{launch.name}</span>
                {address === null && <Menu.Hint className="max-w-48 truncate">{rowHint(view, document, now, t)}</Menu.Hint>}
            </Menu.Item>
            {address !== null &&
                (reachable ? (
                    <Menu.Item className="shrink-0 text-xs text-text-faint underline-offset-2 hover:underline" onClick={() => openLaunchAddress(address)}>
                        {shortAddress(address)}
                    </Menu.Item>
                ) : (
                    <span className="flex shrink-0 items-center px-2 text-xs text-text-faint">{shortAddress(address)}</span>
                ))}
            <span className="flex shrink-0 items-center">
                <LaunchButtons view={view} inMenu />
            </span>
        </div>
    );
}
