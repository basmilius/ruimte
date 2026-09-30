import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, OctagonX, Pencil, Play, Plus, RotateCw, Search, Square, SquareTerminal, type LucideIcon } from 'lucide-react';
import type { GitRepo, LaunchesDocument } from '@ruimte/contracts';
import { Button, Icon, IconButton, Menu, Popover, PromptDialog, Tooltip, useNow } from '@basmilius/desktop-ui';
import { formatAgo } from '@basmilius/desktop-ui/format';
import { chooseLaunch, showLaunchOutput, startLaunch, stopLaunch } from '@/launches/actions';
import { LaunchDot, LaunchStatusIcon } from '@/launches/LaunchControls';
import { foundText, newSuggestions } from '@/launches/editing';
import { headlineOf, launchSections, type LaunchView } from '@/launches/model';
import { useLaunches, useLaunchSuggestions, useProjectLaunches } from '@/launches/state';
import { useProjectRepos } from '@/state/git-repos';
import { useUi } from '@/state/ui';

/*
 * The launches of the project on screen: one button, sized like the icon buttons beside it, that
 * opens a menu with all of them. The dot on it is the worst state among them. It sits in the application's bar and not in
 * a view's, since a launch belongs to the project.
 */
export function LaunchChip() {
    const { t } = useTranslation('launches');
    const anchor = useRef<HTMLDivElement>(null);
    const { key, document, folder, views } = useProjectLaunches();
    const { repos } = useProjectRepos(folder);
    const pressed = useUi((s) => s.panel.open && s.panel.kind === 'launches');
    const ask = useLaunches((s) => s.ask);
    const view = useMemo(() => headlineOf(views), [views]);

    if (key === null) {
        return null;
    }

    const askedName = ask === null ? '' : (document?.launches.find((launch) => launch.id === ask.launchId)?.name ?? '');
    const busyName = ask?.kind === 'busy' ? (document?.launches.find((launch) => launch.id === ask.busy.launchId)?.name ?? '') : '';

    return (
        <div ref={anchor} className="flex shrink-0">
            <Menu.Root>
                <IconButton
                    render={<Menu.Trigger />}
                    label={t('menu.open')}
                    active={pressed}
                    className="w-auto gap-1 px-2 aria-expanded:bg-surface-active aria-expanded:text-text"
                >
                    <span className="relative flex">
                        <Icon icon={Play} size={16} />
                        {view !== null && <LaunchDot view={view} className="pointer-events-none absolute -top-0.5 -right-1" />}
                    </span>
                    <Icon icon={ChevronDown} size={12} />
                </IconButton>
                <Menu.Popup className="min-w-72">
                    <LaunchMenu repos={repos} />
                </Menu.Popup>
            </Menu.Root>

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
                                    void startLaunch(ask.launchId, {
                                        restart: ask.restart,
                                        approve: true,
                                        replace: ask.replace
                                    });
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
                title={t('busy.title', {
                    port: ask?.kind === 'busy' ? ask.busy.port : ''
                })}
                description={t('busy.description', {
                    other: busyName,
                    port: ask?.kind === 'busy' ? ask.busy.port : '',
                    name: askedName
                })}
                confirmLabel={t('busy.confirm')}
                confirmIcon={Play}
                onConfirm={() => {
                    if (ask?.kind === 'busy') {
                        useLaunches.getState().setAsk(null);
                        void startLaunch(ask.launchId, {
                            restart: ask.restart,
                            approve: ask.approve,
                            replace: true
                        });
                    }
                }}
                onOpenChange={() => useLaunches.getState().setAsk(null)}
            />
        </div>
    );
}

/*
 * The checkouts come from whoever holds the menu, read before it opens, so the rows do not regroup
 * under a sub-folder while a person looks. The panel shows the output itself, so it leaves that item out.
 */
export function LaunchMenu({ repos, showOutput = true }: { repos: readonly GitRepo[]; showOutput?: boolean }) {
    const { t } = useTranslation('launches');
    const { document, folder, views } = useProjectLaunches();
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
                        return view === undefined ? null : <LaunchRow key={launch.id} view={view} />;
                    })}
                </Menu.Group>
            ))}
            {sections.length > 0 && <Menu.Separator />}
            {sections.length > 0 && showOutput && (
                <Menu.Item onClick={() => showLaunchOutput()}>
                    <Icon icon={SquareTerminal} size={14} /> {t('showOutput')}
                </Menu.Item>
            )}
            <Menu.Item onClick={() => useLaunches.getState().setDialog({ kind: 'edit', launchId: null })}>
                <Icon icon={Plus} size={14} /> {t('menu.new')}
            </Menu.Item>
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

/* What a row says beside the name: only a state worth a look, never what the launch runs. */
const rowHint = (view: LaunchView, now: number, t: (key: string, options?: Record<string, unknown>) => string): string | null => {
    const { phase, status } = view;
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
    return null;
};

function LaunchRow({ view }: { view: LaunchView }) {
    const { t } = useTranslation('launches');
    const now = useNow(30_000);
    const { launch } = view;
    const hint = rowHint(view, now, t);

    return (
        <div className="project-menu-row flex min-w-0 items-stretch" role="group">
            <Menu.Item className="min-w-0 flex-1" onClick={() => chooseLaunch(launch.id)}>
                <LaunchStatusIcon view={view} size={14} />
                <span className="min-w-0 truncate">{launch.name}</span>
                {hint !== null && <Menu.Hint className="max-w-48 truncate">{hint}</Menu.Hint>}
            </Menu.Item>
            {view.phase === 'stopping' ? (
                <RowAction icon={OctagonX} label={t('forceStop', { name: launch.name })} keepOpen onClick={() => void stopLaunch(launch.id, true)} />
            ) : view.live ? (
                <>
                    <RowAction
                        icon={RotateCw}
                        label={t('restart', { name: launch.name })}
                        keepOpen
                        onClick={() => void startLaunch(launch.id, { restart: true })}
                    />
                    <RowAction icon={Square} label={t('stop', { name: launch.name })} keepOpen fill onClick={() => void stopLaunch(launch.id)} />
                </>
            ) : (
                <RowAction icon={Play} label={t('start', { name: launch.name })} keepOpen fill onClick={() => void startLaunch(launch.id)} />
            )}
            <RowAction
                icon={Pencil}
                label={t('editLaunch', { name: launch.name })}
                onClick={() => useLaunches.getState().setDialog({ kind: 'edit', launchId: launch.id })}
            />
        </div>
    );
}

/* A button at the end of a row, an item of the menu like the row itself so the whole reads as one and the arrow keys reach it. */
function RowAction({
    icon,
    label,
    fill = false,
    keepOpen = false,
    onClick
}: {
    icon: LucideIcon;
    label: string;
    fill?: boolean;
    keepOpen?: boolean;
    onClick: () => void;
}) {
    return (
        <Tooltip label={label}>
            <Menu.Item className="project-menu-actions shrink-0" aria-label={label} closeOnClick={!keepOpen} onClick={onClick}>
                <Icon icon={icon} size={14} className={fill ? 'fill-current' : undefined} />
            </Menu.Item>
        </Tooltip>
    );
}
