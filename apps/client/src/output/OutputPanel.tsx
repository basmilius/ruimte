import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Bot,
    CalendarClock,
    CircleAlert,
    FilePlus,
    HardDrive,
    LayoutGrid,
    ListFilter,
    MonitorDown,
    Package,
    PanelLeft,
    Search,
    Pin,
    SquareArrowOutUpRight,
    Trash2,
    User,
    type LucideIcon
} from 'lucide-react';
import type { ArtifactSummary, RemoteLink } from '@ruimte/contracts';
import {
    Button,
    ButtonGroup,
    ContextMenu,
    ErrorBoundary,
    Icon,
    IconButton,
    Input,
    LazyBoundary,
    lazyNamed,
    Menu,
    PanelEmpty,
    SectionLabel,
    useNow
} from '@adecore/ui';
import { pinArtifact, useCanRemove, useCopyToThisMachine, usePinCanvases } from '@/output/artifact-actions';
import { addArtifactToSidebar, startArtifactDrag } from '@/output/artifact-drag';
import { setDragging } from '@/shell/view-drag';
import { RemoveArtifactDialog, type RemoveArtifactRequest } from '@/output/RemoveArtifactDialog';
import type { CopyToProjectRequest } from '@/output/CopyToProjectDialog';
import { formatBytes, formatMoment } from '@adecore/ui/format';
import {
    ALL,
    DATES,
    defaultFilters,
    filtersChanged,
    groupByDate,
    KINDS,
    matchesFilters,
    routinesOf,
    SIZES,
    SOURCES,
    type ArtifactSource,
    type OutputFilters
} from '@/output/artifact-list';
import { useArtifactList } from '@/output/artifacts';
import { useLinkedMachines } from '@/output/linked-machines';
import { useEndpointIdOfMachine, useEndpoints } from '@/state/endpoints';
import { KindTile, OutputProjectGlyph } from '@/output/look';
import { openArtifact, useOutputRequest } from '@/output/open';
import { PanelHeaderActions, PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { useMachineAnswers } from '@/transport/features';

const CopyToProjectDialog = lazyNamed(() => import('@/output/CopyToProjectDialog'), 'CopyToProjectDialog');

const MINUTE_MS = 60_000;

const SOURCE_ICONS: Record<ArtifactSource, LucideIcon> = { agent: Bot, person: User, routine: CalendarClock };

const NO_ARTIFACTS: readonly ArtifactSummary[] = [];

/* The panel asked to show one project: this window's own as it starts, any other among All projects, where its rows carry its mark. */
function filtersFor(asked: string, projectId: string | null): OutputFilters {
    return asked === projectId ? defaultFilters(projectId) : { ...defaultFilters(projectId), project: ALL };
}

/*
 * Everything the machine keeps in Output, the window's project first. A row opens the artifact as a
 * view, where its versions are. Filters beyond a project are the client's.
 */
export function OutputPanel() {
    const { t } = useTranslation('output');
    const endpointId = useEndpointId();
    const answers = useMachineAnswers(endpointId, 'artifact.list');
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const list = useArtifactList(endpointId, {}, answers);
    const request = useOutputRequest((s) => s.project);
    const [filters, setFilters] = useState<OutputFilters>(() => (request === null ? defaultFilters(projectId) : filtersFor(request.projectId, projectId)));
    const [taken, setTaken] = useState(request);
    // A request that came while the panel was already open sets the filters the way a person would.
    if (request !== null && request !== taken) {
        setTaken(request);
        setFilters(filtersFor(request.projectId, projectId));
    }
    useEffect(() => {
        if (request !== null) {
            useOutputRequest.setState({ project: null });
        }
    }, [request]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const now = useNow(MINUTE_MS);
    const linked = useLinkedMachines();
    const [copying, setCopying] = useState<{ artifact: ArtifactSummary; request: CopyToProjectRequest } | null>(null);
    const [removing, setRemoving] = useState<RemoveArtifactRequest | null>(null);
    const actions: RowActions = {
        copy: (artifact) => setCopying({ artifact, request: { version: artifact.latest, open: true, round: (copying?.request.round ?? 0) + 1 } }),
        remove: (artifact) => setRemoving({ artifact, version: null, versionCount: artifact.versionCount, totalBytes: artifact.totalBytes, open: true })
    };

    const artifacts = list?.status === 'ready' ? list.artifacts : NO_ARTIFACTS;
    const header = (
        <PanelHeaderSlot>
            <PanelHeaderActions>
                <ButtonGroup>
                    <IconButton icon={Search} label={t('panel.search')} active={searchOpen} onClick={() => setSearchOpen(!searchOpen)} />
                    <FiltersMenu artifacts={artifacts} filters={filters} projectId={projectId} onChange={setFilters} />
                </ButtonGroup>
            </PanelHeaderActions>
        </PanelHeaderSlot>
    );

    if (list === null || list.status !== 'ready') {
        return (
            <>
                {header}
                {list?.status === 'loading' ? (
                    <PanelEmpty busy>{t('panel.loading')}</PanelEmpty>
                ) : (
                    <PanelEmpty icon={CircleAlert}>{list === null ? t('panel.tooOld') : t('panel.failed')}</PanelEmpty>
                )}
            </>
        );
    }

    const shown = list.artifacts.filter((artifact) => matchesFilters(artifact, filters, query, now));
    const everywhere = filters.project === ALL;
    const shownBytes = shown.reduce((sum, artifact) => sum + artifact.totalBytes, 0);

    return (
        <>
            {header}
            <ScopeLine filters={filters} projectId={projectId} onReset={() => setFilters(defaultFilters(projectId))} />
            {searchOpen && (
                <div className="flex shrink-0 px-2 pt-2">
                    <Input
                        icon={Search}
                        className="min-w-0 grow"
                        placeholder={t('panel.search')}
                        aria-label={t('panel.search')}
                        spellCheck={false}
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape' && query !== '') {
                                event.stopPropagation();
                                setQuery('');
                            }
                        }}
                    />
                </div>
            )}
            <div className="min-h-0 grow overflow-y-auto px-2 pb-2">
                {list.artifacts.length === 0 ? (
                    <PanelEmpty icon={Package} fill="full">
                        <span className="flex flex-col gap-1">
                            <span className="text-text">{t('panel.emptyTitle')}</span>
                            <span>{t('panel.empty')}</span>
                        </span>
                    </PanelEmpty>
                ) : shown.length === 0 ? (
                    <PanelEmpty fill="full">{t('panel.noMatch')}</PanelEmpty>
                ) : (
                    groupByDate(shown, now).map(({ group, artifacts: grouped }) => (
                        <section key={group} className="flex flex-col gap-0.5" aria-label={t(`panel.groups.${group}`)}>
                            <SectionLabel render={<h3 />} className="px-2 pt-3 pb-1">
                                {t(`panel.groups.${group}`)}
                            </SectionLabel>
                            {grouped.map((artifact) => (
                                <ArtifactRow
                                    key={artifact.artifactId}
                                    endpointId={endpointId}
                                    artifact={artifact}
                                    everywhere={everywhere}
                                    now={now}
                                    actions={actions}
                                />
                            ))}
                        </section>
                    ))
                )}
                {everywhere &&
                    linked.map((link) => (
                        <ErrorBoundary key={link.machineId} label={t('panel.failed')} resetKeys={[link.machineId]}>
                            <LinkedMachineOutput link={link} filters={filters} query={query} now={now} />
                        </ErrorBoundary>
                    ))}
            </div>
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-text-muted">
                <Icon icon={HardDrive} size={14} className="shrink-0 text-text-faint" />
                <span className="grow truncate tabular-nums">{t('panel.shown', { count: shown.length, size: formatBytes(shownBytes) })}</span>
                <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => useUi.getState().setSettings({ open: true, section: 'machines', target: 'machines.machine.storage.output' })}
                >
                    {t('panel.storage')}
                </Button>
            </div>
            {copying !== null && (
                <LazyBoundary>
                    <CopyToProjectDialog
                        endpointId={endpointId}
                        artifact={copying.artifact}
                        request={copying.request}
                        onClose={() => setCopying({ ...copying, request: { ...copying.request, open: false } })}
                    />
                </LazyBoundary>
            )}
            <RemoveArtifactDialog endpointId={endpointId} request={removing} onClose={() => removing !== null && setRemoving({ ...removing, open: false })} />
        </>
    );
}

/*
 * The Output of the project a linked machine keeps for this one, read straight from that machine, and
 * only while something else holds its link: a list never opens one.
 */
function LinkedMachineOutput({ link, filters, query, now }: { link: RemoteLink; filters: OutputFilters; query: string; now: number }) {
    const { t } = useTranslation('output');
    const endpointId = useEndpointIdOfMachine(link.machineId);
    const answers = useMachineAnswers(endpointId, 'artifact.list');
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label) ?? link.label;
    const list = useArtifactList(endpointId, { projectId: link.remoteProjectId }, answers);
    const shown = list?.status === 'ready' ? list.artifacts.filter((artifact) => matchesFilters(artifact, filters, query, now)) : NO_ARTIFACTS;
    if (shown.length === 0) {
        return null;
    }
    const label = t('panel.onMachine', { machine });
    return (
        <section className="flex flex-col gap-0.5" aria-label={label}>
            <SectionLabel render={<h3 />} className="px-2 pt-3 pb-1">
                {label}
            </SectionLabel>
            {shown.map((artifact) => (
                <ArtifactRow key={artifact.artifactId} endpointId={endpointId} machineId={link.machineId} artifact={artifact} everywhere now={now} />
            ))}
        </section>
    );
}

/* What a row's right click asks the panel for, with the dialogs that live once in the panel. */
interface RowActions {
    copy(artifact: ArtifactSummary): void;
    remove(artifact: ArtifactSummary): void;
}

/* The right click on a row, about the latest version. A row of another machine is only opened or copied here. */
function ArtifactRowMenu({
    endpointId,
    machineId,
    artifact,
    actions
}: {
    endpointId: string;
    machineId: string | undefined;
    artifact: ArtifactSummary;
    actions: RowActions | undefined;
}) {
    const { t } = useTranslation('output');
    const open = (
        <ContextMenu.Item onClick={() => openArtifact(artifact.artifactId, artifact.title, null, machineId)}>
            <Icon icon={SquareArrowOutUpRight} size={14} /> {t('menu.open')}
        </ContextMenu.Item>
    );
    if (machineId !== undefined) {
        return (
            <>
                {open}
                <CopyHereItem machineId={machineId} artifact={artifact} />
            </>
        );
    }
    return (
        <>
            {open}
            {actions !== undefined && (
                <ContextMenu.Item onClick={() => actions.copy(artifact)}>
                    <Icon icon={FilePlus} size={14} /> {t('menu.copyToProject')}
                </ContextMenu.Item>
            )}
            <PinToCanvasSubmenu artifact={artifact} />
            <ContextMenu.Item onClick={() => void addArtifactToSidebar(artifact)}>
                <Icon icon={PanelLeft} size={14} /> {t('menu.addToSidebar')}
            </ContextMenu.Item>
            {actions !== undefined && <RemoveItem endpointId={endpointId} onRemove={() => actions.remove(artifact)} />}
        </>
    );
}

/* Pin to canvas as a submenu of the right click, one row per canvas; the node follows the latest. */
function PinToCanvasSubmenu({ artifact }: { artifact: ArtifactSummary }) {
    const { t } = useTranslation('output');
    const canvases = usePinCanvases();
    return (
        <ContextMenu.SubmenuRoot disabled={canvases.length === 0}>
            <ContextMenu.SubmenuTrigger disabled={canvases.length === 0}>
                <Icon icon={Pin} size={14} /> <span className="grow">{t('view.pinToCanvas')}</span>
            </ContextMenu.SubmenuTrigger>
            <ContextMenu.Popup className="min-w-48">
                {canvases.map((view) => (
                    <ContextMenu.Item key={view.id} onClick={() => void pinArtifact(artifact, null, view.id)}>
                        <span className="truncate">{view.name}</span>
                    </ContextMenu.Item>
                ))}
            </ContextMenu.Popup>
        </ContextMenu.SubmenuRoot>
    );
}

function RemoveItem({ endpointId, onRemove }: { endpointId: string; onRemove(): void }) {
    const { t } = useTranslation('output');
    if (!useCanRemove(endpointId, undefined)) {
        return null;
    }
    return (
        <>
            <ContextMenu.Separator />
            <ContextMenu.Item className="text-status-error" onClick={onRemove}>
                <Icon icon={Trash2} size={14} /> {t('remove.action')}
            </ContextMenu.Item>
        </>
    );
}

function CopyHereItem({ machineId, artifact }: { machineId: string; artifact: ArtifactSummary }) {
    const { t } = useTranslation('output');
    const machineCopy = useCopyToThisMachine(machineId, artifact);
    if (machineCopy === null) {
        return null;
    }
    return (
        <ContextMenu.Item disabled={machineCopy.copying} onClick={() => machineCopy.copy(artifact.latest)}>
            <Icon icon={MonitorDown} size={14} /> {t('copyHere.action')}
        </ContextMenu.Item>
    );
}

function ArtifactRow({
    endpointId,
    machineId,
    artifact,
    everywhere,
    now,
    actions
}: {
    endpointId: string;
    /* Set for a row of another machine of the account. */
    machineId?: string;
    artifact: ArtifactSummary;
    everywhere: boolean;
    now: number;
    actions?: RowActions;
}) {
    const { t } = useTranslation('output');
    const maker = artifact.latest.provenance.maker;
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={
                    <button
                        type="button"
                        className="flex min-w-0 items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-surface-hover data-popup-open:bg-surface-hover"
                        onClick={() => openArtifact(artifact.artifactId, artifact.title, null, machineId)}
                        draggable={machineId === undefined}
                        onDragStart={(event) => machineId === undefined && startArtifactDrag(event.dataTransfer, artifact)}
                        onDragEnd={() => setDragging(null)}
                    />
                }
            >
                <KindTile kind={artifact.kind} />
                <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-sm font-medium text-text">{artifact.title}</span>
                    <span className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
                        {everywhere ? (
                            <>
                                <OutputProjectGlyph endpointId={endpointId} projectId={artifact.projectId} />
                                <span className="max-w-28 shrink-0 truncate">{artifact.projectName},</span>
                            </>
                        ) : (
                            <Icon icon={SOURCE_ICONS[maker]} size={12} className="shrink-0 text-text-faint" />
                        )}
                        <span className="truncate">{t('panel.versions', { count: artifact.versionCount })}</span>
                    </span>
                </span>
                <span className="shrink-0 text-xs text-text-faint tabular-nums">{formatMoment(artifact.latest.createdAt, now)}</span>
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                <ArtifactRowMenu endpointId={endpointId} machineId={machineId} artifact={artifact} actions={actions} />
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

/* How many filters beyond the project narrow the list. */
function narrowing(filters: OutputFilters): number {
    return [filters.kind, filters.source, filters.routine, filters.date, filters.size].filter((value) => value !== ALL).length;
}

/* What the list is narrowed to, only while it differs from where the panel starts, with the way back. */
function ScopeLine({ filters, projectId, onReset }: { filters: OutputFilters; projectId: string | null; onReset(): void }) {
    const { t } = useTranslation('output');
    if (!filtersChanged(filters, projectId)) {
        return null;
    }
    const count = narrowing(filters);
    const otherProject = filters.project !== defaultFilters(projectId).project;
    return (
        <div className={`${FILE_TOOLBAR} text-xs text-text-muted`}>
            {otherProject && (
                <>
                    <Icon icon={LayoutGrid} size={12} className="shrink-0 text-text-faint" />
                    <span className="min-w-0 truncate">{t('panel.filter.allProjects')}</span>
                </>
            )}
            {otherProject && count > 0 && (
                <span aria-hidden="true" className="text-text-faint">
                    ·
                </span>
            )}
            {count > 0 && <span className="shrink-0">{t('panel.narrowed', { count })}</span>}
            <span className="grow" />
            <Button size="xs" variant="ghost" onClick={onReset}>
                {t('panel.reset')}
            </Button>
        </div>
    );
}

/* Every filter in one menu behind the header's button, which stands out while any of them differs from where the panel starts. */
function FiltersMenu({
    artifacts,
    filters,
    projectId,
    onChange
}: {
    artifacts: readonly ArtifactSummary[];
    filters: OutputFilters;
    projectId: string | null;
    onChange(filters: OutputFilters): void;
}) {
    const { t } = useTranslation('output');
    const routines = routinesOf(artifacts);
    const changed = filtersChanged(filters, projectId);
    const any = t('panel.filter.any');
    const set = (patch: Partial<OutputFilters>): void => onChange({ ...filters, ...patch });
    // The window's project or every project: a row in All projects carries its project's mark, so no other single project is a choice.
    const projectOptions = [
        ...(projectId === null ? [] : [{ value: projectId, label: t('panel.filter.thisProject') }]),
        { value: ALL, label: t('panel.filter.allProjects') }
    ];
    return (
        <Menu.Root>
            <IconButton icon={ListFilter} label={t('panel.filters')} active={changed} render={<Menu.Trigger />} />
            <Menu.Popup align="end" className="min-w-56">
                {projectId !== null && (
                    <FilterSubmenu
                        title={t('panel.filter.project')}
                        label={filters.project === ALL ? t('panel.filter.allProjects') : t('panel.filter.thisProject')}
                        value={filters.project}
                        options={projectOptions}
                        onChange={(project) => set({ project })}
                    />
                )}
                <FilterSubmenu
                    title={t('panel.filter.kind')}
                    label={filters.kind === ALL ? any : t(`kinds.${filters.kind}`)}
                    value={filters.kind}
                    options={[{ value: ALL, label: any }, ...KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))]}
                    onChange={(kind) => set({ kind: kind as OutputFilters['kind'] })}
                />
                <FilterSubmenu
                    title={t('panel.filter.source')}
                    label={filters.source === ALL ? any : t(`panel.filter.sources.${filters.source}`)}
                    value={filters.source}
                    options={[{ value: ALL, label: any }, ...SOURCES.map((source) => ({ value: source, label: t(`panel.filter.sources.${source}`) }))]}
                    onChange={(source) => set({ source: source as OutputFilters['source'] })}
                />
                {routines.length > 0 && (
                    <FilterSubmenu
                        title={t('panel.filter.routine')}
                        label={filters.routine === ALL ? any : filters.routine}
                        value={filters.routine}
                        options={[{ value: ALL, label: any }, ...routines.map((routine) => ({ value: routine, label: routine }))]}
                        onChange={(routine) => set({ routine })}
                    />
                )}
                <FilterSubmenu
                    title={t('panel.filter.time')}
                    label={filters.date === ALL ? any : t(`panel.filter.dates.${filters.date}`)}
                    value={filters.date}
                    options={DATES.map((date) => ({ value: date, label: date === ALL ? any : t(`panel.filter.dates.${date}`) }))}
                    onChange={(date) => set({ date: date as OutputFilters['date'] })}
                />
                <FilterSubmenu
                    title={t('panel.filter.size')}
                    label={filters.size === ALL ? any : t(`panel.filter.sizes.${filters.size}`)}
                    value={filters.size}
                    options={SIZES.map((size) => ({ value: size, label: size === ALL ? any : t(`panel.filter.sizes.${size}`) }))}
                    onChange={(size) => set({ size: size as OutputFilters['size'] })}
                />
                <Menu.Separator />
                <Menu.Item disabled={!changed} onClick={() => onChange(defaultFilters(projectId))}>
                    {t('panel.reset')}
                </Menu.Item>
            </Menu.Popup>
        </Menu.Root>
    );
}

/* One filter as a row of the menu that says what it is set to and opens its choices. */
function FilterSubmenu({
    title,
    label,
    value,
    options,
    onChange
}: {
    title: string;
    label: string;
    value: string;
    options: readonly { value: string; label: string }[];
    onChange(value: string): void;
}) {
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger>
                <span className="grow">{title}</span>
                <Menu.Hint className="max-w-36 truncate">{label}</Menu.Hint>
            </Menu.SubmenuTrigger>
            <Menu.Popup className="max-h-72 min-w-48 overflow-y-auto">
                <Menu.RadioGroup value={value} onValueChange={(next: string) => onChange(next)}>
                    {options.map((option) => (
                        <Menu.RadioItem key={option.value} value={option.value}>
                            <span className="grow truncate">{option.label}</span>
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}
