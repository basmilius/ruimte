import { AgentModelLabel } from '@adecore/agents-react/providers';
import { useChats } from '@adecore/agents-react/state';
import { patchOf } from '@adecore/merge';
import {
    Button,
    EmptyState,
    ErrorBoundary,
    Icon,
    IconButton,
    LazyBoundary,
    Menu,
    Pill,
    Popover,
    ScrollArea,
    SectionLabel,
    Tooltip,
    lazyNamed,
    messageOf
} from '@adecore/ui';
import { formatBytes, formatDayClock } from '@adecore/ui/format';
import {
    BYTES_READ_MAX_BYTES,
    type Artifact,
    type ArtifactFile,
    type ArtifactGetResult,
    type ArtifactProvenance,
    type ArtifactVersion
} from '@ruimte/contracts';
import {
    ArrowRight,
    ChevronDown,
    CircleAlert,
    Clock,
    Download,
    FilePlus,
    GitCompare,
    Info,
    Lock,
    MonitorDown,
    MoreHorizontal,
    Package,
    Pin,
    Trash2,
    WifiOff,
    type LucideIcon
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { pinArtifact, useCanRemove, useCopyToThisMachine, usePinCanvases } from '@/output/artifact-actions';
import { canDownload, downloadArtifactFile, useArtifactText, type ArtifactFileRef } from '@/output/artifact-bytes';
import { comparable } from '@/output/artifact-list';
import { ArtifactFileBody } from '@/output/ArtifactFileBody';
import type { CopyToProjectRequest } from '@/output/CopyToProjectDialog';
import { fileViewOf, firstShownFile } from '@/output/file-view';
import { showChat, useChatName } from '@/output/kinds';
import { selectArtifactVersion, useArtifactSelection } from '@/output/open';
import { RemoveArtifactDialog, type RemoveArtifactRequest } from '@/output/RemoveArtifactDialog';
import { useArtifact } from '@/output/use-artifact';
import { FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { useEndpointId } from '@/state/current-endpoint';
import { useEndpointIdOfMachine, useEndpoints } from '@/state/endpoints';
import { artifactTabKey } from '@/state/files';
import { endpointKey } from '@/state/keys';
import { showRoutine } from '@/state/routines-stage';
import { useToasts } from '@/state/toasts';
import { useFileToolbarSlot } from '@/surface/panels/file-toolbar-slot';
import { useMachineAnswers } from '@/transport/features';
import { useMachineUrl } from '@/transport/machine-url';

const UnifiedDiff = lazyNamed(() => import('@adecore/agents-react/chat/ui'), 'UnifiedDiff');
const CopyToProjectDialog = lazyNamed(() => import('@/output/CopyToProjectDialog'), 'CopyToProjectDialog');

/*
 * One artifact of Output as a view: the version picked across the whole width, with its versions,
 * where it came from and what to do with it behind the controls of the bar. Every byte is read by the
 * artifact's id and a version's id; the view never names a path on the machine.
 */
export function ArtifactView({
    artifactId,
    machineId,
    pin,
    inItsRoutine = false
}: {
    artifactId: string;
    machineId?: string;
    pin?: ArtifactPin;
    inItsRoutine?: boolean;
}) {
    const { t } = useTranslation('output');
    const own = useEndpointId();
    const elsewhere = useEndpointIdOfMachine(machineId ?? '');
    const endpointId = machineId === undefined ? own : elsewhere;
    const answers = useMachineAnswers(endpointId, 'artifact.get');
    const state = useArtifact(endpointId, artifactId, answers);

    if (!answers) {
        return <Centered icon={CircleAlert}>{t('panel.tooOld')}</Centered>;
    }
    if (state.status === 'loading') {
        return (
            <Centered busy>
                <span>{t('view.loading')}</span>
            </Centered>
        );
    }
    if (state.status === 'unreachable') {
        return <Centered icon={WifiOff}>{t('view.unreachable')}</Centered>;
    }
    if (state.status === 'gone' || state.result.versions.length === 0) {
        return <Centered icon={Package}>{t('view.gone')}</Centered>;
    }
    return <ArtifactBody endpointId={endpointId} machineId={machineId} result={state.result} pin={pin} inItsRoutine={inItsRoutine} />;
}

/*
 * The version a view of the project stays on, stored with the view the way a node stores it: null
 * follows the latest. Without one the version picked is the window's, as for a loose tab.
 */
interface ArtifactPin {
    version: string | null;
    set(version: string | null): void;
}

function Centered({ icon, busy, children }: { icon?: LucideIcon; busy?: boolean; children: ReactNode }) {
    return (
        <div className="grid min-h-0 grow place-items-center">
            <EmptyState icon={icon} busy={busy}>
                {children}
            </EmptyState>
        </div>
    );
}

/* `machineId` is set for an artifact another machine of the account keeps, which the window copies but never writes into. */
function ArtifactBody({
    endpointId,
    machineId,
    result,
    pin,
    inItsRoutine
}: {
    endpointId: string;
    machineId: string | undefined;
    result: ArtifactGetResult;
    pin: ArtifactPin | undefined;
    inItsRoutine: boolean;
}) {
    const { t } = useTranslation('output');
    const { artifact, versions } = result;
    const selected = useArtifactSelection((s) => s.versions[artifactTabKey(artifact.artifactId, machineId)] ?? null);
    const chosen = pin === undefined ? selected : pin.version;
    const [comparing, setComparing] = useState(false);
    const [baseId, setBaseId] = useState<string | null>(null);
    const [copy, setCopy] = useState<CopyToProjectRequest | null>(null);
    const [removing, setRemoving] = useState<RemoveArtifactRequest | null>(null);
    const canRemove = useCanRemove(endpointId, machineId);
    const latest = versions[0]!;
    const totalBytes = versions.reduce((sum, entry) => sum + entry.bytes, 0);
    const askRemove = (picked: ArtifactVersion | null): void =>
        setRemoving({ artifact, version: picked, versionCount: versions.length, totalBytes, open: true });
    // A version picked from the panel that a cleanup took since is said to be gone, not swapped for another.
    const version = chosen === null ? latest : (versions.find((entry) => entry.versionId === chosen) ?? null);
    const canCompare = version !== null && versions.length > 1 && comparable(version);
    const compare = comparing && canCompare;
    const base = compare ? baseFor(versions, version, baseId) : null;
    const routineId = version?.provenance.routineId;

    const pick = (picked: ArtifactVersion): void => {
        const next = picked.versionId === latest.versionId ? null : picked.versionId;
        if (pin === undefined) {
            selectArtifactVersion(artifact.artifactId, next, machineId);
        } else {
            pin.set(next);
        }
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <ArtifactToolbar asView={pin !== undefined}>
                <VersionsMenu versions={versions} selected={version} onPick={pick} onRemove={canRemove ? askRemove : undefined} />
                {compare && version !== null && base !== null && (
                    <BaseMenu versions={versions} version={version} base={base} onPick={(picked) => setBaseId(picked.versionId)} />
                )}
                <span className="grow" />
                <FileToolbarToggle
                    icon={GitCompare}
                    label={canCompare ? t('view.compare') : t('view.compareOff')}
                    active={compare}
                    disabled={!canCompare}
                    onClick={() => setComparing(!comparing)}
                />
                {machineId === undefined && routineId !== undefined && !inItsRoutine && (
                    <IconButton
                        icon={Clock}
                        size="sm"
                        label={t('view.openInRoutine')}
                        onClick={() => showRoutine({ projectId: artifact.projectId, routineId }, version?.provenance.runId ?? null)}
                    />
                )}
                {version !== null && (
                    <OriginPopover endpointId={endpointId} artifact={artifact} version={version} latest={latest} chatPresent={result.chatPresent} />
                )}
                {version !== null && (
                    <ActionsMenu
                        artifact={artifact}
                        version={version}
                        latest={latest}
                        machineId={machineId}
                        onCopy={() => setCopy({ version, open: true, round: (copy?.round ?? 0) + 1 })}
                        onRemove={canRemove ? () => askRemove(null) : undefined}
                    />
                )}
            </ArtifactToolbar>
            <div className="flex min-h-0 min-w-0 grow flex-col">
                {version === null ? (
                    <Centered icon={Package}>
                        <span className="flex flex-col gap-1">
                            <span className="text-text">{t('view.versionGone')}</span>
                            <span>{t('view.versionGoneDetail')}</span>
                        </span>
                    </Centered>
                ) : (
                    <ErrorBoundary label={t('view.failed')} resetKeys={[version.versionId, base?.versionId ?? '']} className="flex min-h-0 grow flex-col">
                        {compare && base !== null ? (
                            <CompareBody endpointId={endpointId} artifact={artifact} version={version} base={base} />
                        ) : (
                            <VersionBody endpointId={endpointId} artifact={artifact} version={version} />
                        )}
                    </ErrorBoundary>
                )}
            </div>
            {machineId === undefined && (
                <LazyBoundary>
                    <CopyToProjectDialog
                        endpointId={endpointId}
                        artifact={artifact}
                        request={copy}
                        onClose={() => copy !== null && setCopy({ ...copy, open: false })}
                    />
                </LazyBoundary>
            )}
            <RemoveArtifactDialog endpointId={endpointId} request={removing} onClose={() => removing !== null && setRemoving({ ...removing, open: false })} />
        </div>
    );
}

/* The version Compare sets beside the one picked: the one a person chose, or the one before it. */
function baseFor(versions: readonly ArtifactVersion[], version: ArtifactVersion | null, baseId: string | null): ArtifactVersion | null {
    if (version === null) {
        return null;
    }
    const chosen = versions.find((entry) => entry.versionId === baseId && entry.versionId !== version.versionId && comparable(entry));
    if (chosen !== undefined) {
        return chosen;
    }
    const index = versions.indexOf(version);
    return versions.slice(index + 1).find(comparable) ?? versions.find((entry) => entry !== version && comparable(entry)) ?? null;
}

/* A view hands its controls to the bar its view already carries; a loose tab draws one under the tabs, so the tab bar keeps only tabs. */
function ArtifactToolbar({ asView, children }: { asView: boolean; children: ReactNode }) {
    const { host, mount } = useFileToolbarSlot();
    if (asView && host !== null) {
        return createPortal(children, host);
    }
    // A slot between two mounts, as when the cell bar folds, is not a bar to draw instead.
    if (asView && mount !== null) {
        return null;
    }
    // The measures of a view's separate bar (`data-pane-actions` in CellToolbar and its slot in ViewToolbar), so both read the same.
    return (
        <div className="flex h-10 shrink-0 items-center border-b border-border bg-surface px-2 text-xs">
            <div className="flex min-w-0 grow items-center justify-end gap-1">{children}</div>
        </div>
    );
}

function versionLabel(version: ArtifactVersion): { number: number; date: string } {
    return { number: version.number, date: formatDayClock(version.createdAt) };
}

/* A label that adds nothing to the bar's least width, so a narrow bar truncates it before the cell folds the controls away. */
function ShrinkingLabel({ children }: { children: ReactNode }) {
    return (
        <span className="grid min-w-6 grid-cols-[minmax(0,max-content)]">
            <span className="truncate tabular-nums">{children}</span>
        </span>
    );
}

/* The version on screen as the bar's first control, and every version behind it, newest first. */
function VersionsMenu({
    versions,
    selected,
    onPick,
    onRemove
}: {
    versions: readonly ArtifactVersion[];
    selected: ArtifactVersion | null;
    onPick(version: ArtifactVersion): void;
    /* Set where a person may remove a version, which each row then offers. */
    onRemove?: (version: ArtifactVersion) => void;
}) {
    const { t } = useTranslation('output');
    const latest = versions[0]!;
    return (
        <Menu.Root>
            <Menu.Trigger render={<Button size="xs" variant="ghost" className="shrink!" aria-label={t('view.versions')} />}>
                <ShrinkingLabel>{selected === null ? t('view.versionGone') : t('view.versionRow', versionLabel(selected))}</ShrinkingLabel>
                {selected?.versionId === latest.versionId && <Pill size="sm">{t('view.latest')}</Pill>}
                <Icon icon={ChevronDown} size={12} className="shrink-0" />
            </Menu.Trigger>
            <Menu.Popup align="start" className="max-h-80 min-w-64 overflow-y-auto">
                <Menu.RadioGroup
                    value={selected?.versionId ?? ''}
                    onValueChange={(next: string) => {
                        const picked = versions.find((entry) => entry.versionId === next);
                        if (picked !== undefined) {
                            onPick(picked);
                        }
                    }}
                >
                    {versions.map((version) => {
                        const item = (
                            <Menu.RadioItem key={version.versionId} value={version.versionId} className="tabular-nums" closeOnClick>
                                <span className="grow truncate">{t('view.versionRow', versionLabel(version))}</span>
                                {version.versionId === latest.versionId && <Pill size="sm">{t('view.latest')}</Pill>}
                                <Menu.Hint>{formatBytes(version.bytes)}</Menu.Hint>
                            </Menu.RadioItem>
                        );
                        if (onRemove === undefined) {
                            return item;
                        }
                        return (
                            <Menu.Row key={version.versionId} aria-label={t('view.versionRow', versionLabel(version))}>
                                {item}
                                <Menu.RowAction icon={Trash2} label={t('remove.version')} onClick={() => onRemove(version)} />
                            </Menu.Row>
                        );
                    })}
                </Menu.RadioGroup>
            </Menu.Popup>
        </Menu.Root>
    );
}

/* In Compare, the version the one on screen is set beside. */
function BaseMenu({
    versions,
    version,
    base,
    onPick
}: {
    versions: readonly ArtifactVersion[];
    version: ArtifactVersion;
    base: ArtifactVersion;
    onPick(version: ArtifactVersion): void;
}) {
    const { t } = useTranslation('output');
    const choices = versions.filter((entry) => entry.versionId !== version.versionId && comparable(entry));
    return (
        <Menu.Root>
            <Menu.Trigger render={<Button size="xs" variant="ghost" className="shrink!" aria-label={t('view.pickBase')} />}>
                <ShrinkingLabel>{t('view.comparedWith', { number: base.number })}</ShrinkingLabel>
                <Icon icon={ChevronDown} size={12} className="shrink-0" />
            </Menu.Trigger>
            <Menu.Popup align="start" className="max-h-80 min-w-64 overflow-y-auto">
                <Menu.RadioGroup
                    value={base.versionId}
                    onValueChange={(next: string) => {
                        const picked = choices.find((entry) => entry.versionId === next);
                        if (picked !== undefined) {
                            onPick(picked);
                        }
                    }}
                >
                    {choices.map((entry) => (
                        <Menu.RadioItem key={entry.versionId} value={entry.versionId} className="tabular-nums" closeOnClick>
                            {t('view.versionRow', versionLabel(entry))}
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </Menu.Popup>
        </Menu.Root>
    );
}

/*
 * What a person does with the version on screen, behind the bar's last button. Another machine's
 * artifact is only copied here; Pin to canvas keeps the version picked unless that is the latest,
 * which the node then follows.
 */
function ActionsMenu({
    artifact,
    version,
    latest,
    machineId,
    onCopy,
    onRemove
}: {
    artifact: Artifact;
    version: ArtifactVersion;
    latest: ArtifactVersion;
    machineId: string | undefined;
    onCopy(): void;
    onRemove?: () => void;
}) {
    const { t } = useTranslation('output');
    const canvases = usePinCanvases();
    const machineCopy = useCopyToThisMachine(machineId ?? '', artifact);
    if (machineId !== undefined && machineCopy === null) {
        return null;
    }
    return (
        <Menu.Root>
            <IconButton icon={MoreHorizontal} size="sm" label={t('common:action.more')} render={<Menu.Trigger />} />
            <Menu.Popup align="end" className="min-w-52">
                {/* Only another machine's artifact has a copy here, so the menu is that copy or this machine's actions. */}
                {machineCopy === null ? (
                    <>
                        <Menu.Item onClick={onCopy}>
                            <Icon icon={FilePlus} size={14} /> {t('menu.copyToProject')}
                        </Menu.Item>
                        <Menu.SubmenuRoot disabled={canvases.length === 0}>
                            <Menu.SubmenuTrigger disabled={canvases.length === 0}>
                                <Icon icon={Pin} size={14} /> <span className="grow">{t('view.pinToCanvas')}</span>
                            </Menu.SubmenuTrigger>
                            <Menu.Popup className="min-w-48">
                                {canvases.map((view) => (
                                    <Menu.Item
                                        key={view.id}
                                        onClick={() => void pinArtifact(artifact, version.versionId === latest.versionId ? null : version.versionId, view.id)}
                                    >
                                        <span className="truncate">{view.name}</span>
                                    </Menu.Item>
                                ))}
                            </Menu.Popup>
                        </Menu.SubmenuRoot>
                        {onRemove !== undefined && (
                            <>
                                <Menu.Separator />
                                <Menu.Item className="text-status-error" onClick={onRemove}>
                                    <Icon icon={Trash2} size={14} /> {t('remove.action')}
                                </Menu.Item>
                            </>
                        )}
                    </>
                ) : (
                    <Menu.Item disabled={machineCopy.copying} onClick={() => machineCopy.copy(version)}>
                        <Icon icon={MonitorDown} size={14} /> {machineCopy.copying ? t('copyHere.copying') : t('copyHere.action')}
                    </Menu.Item>
                )}
            </Menu.Popup>
        </Menu.Root>
    );
}

function refOf(artifact: Artifact, version: ArtifactVersion, file: number): ArtifactFileRef {
    return { artifactId: artifact.artifactId, versionId: version.versionId, file };
}

/*
 * What a version holds, drawn by what its files are, whatever its kind says; an artifact node on a
 * canvas draws the same. Several pictures stand together, any other set shows one file at a time.
 */
export function VersionBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    const [picked, setPicked] = useState<{ versionId: string; file: number } | null>(null);
    if (version.files.length > 1 && version.files.every((file) => fileViewOf(file) === 'image')) {
        return <ImagesBody endpointId={endpointId} artifact={artifact} version={version} />;
    }
    const index = picked !== null && picked.versionId === version.versionId ? picked.file : firstShownFile(version);
    const file = version.files[index]!;
    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {version.files.length > 1 && (
                <FilePicker files={version.files} index={index} onPick={(next) => setPicked({ versionId: version.versionId, file: next })} />
            )}
            {fileViewOf(file) === 'none' ? (
                <FilesBody endpointId={endpointId} artifact={artifact} version={version} />
            ) : (
                <ArtifactFileBody
                    key={`${version.versionId}:${index}`}
                    endpointId={endpointId}
                    reference={refOf(artifact, version, index)}
                    file={file}
                    title={artifact.title}
                    createdAt={version.createdAt}
                />
            )}
        </div>
    );
}

function FilePicker({ files, index, onPick }: { files: readonly ArtifactFile[]; index: number; onPick: (index: number) => void }) {
    const { t } = useTranslation('output');
    return (
        <ScrollArea
            axis="x"
            role="group"
            aria-label={t('view.files')}
            className="h-9 shrink-0 border-b border-border"
            viewportClassName="flex items-center gap-1 px-2"
        >
            {files.map((file, i) => (
                <Button
                    key={i}
                    size="xs"
                    variant={i === index ? 'secondary' : 'ghost'}
                    aria-pressed={i === index}
                    className="shrink-0"
                    onClick={() => onPick(i)}
                >
                    {file.name}
                </Button>
            ))}
        </ScrollArea>
    );
}

function CompareBody({ endpointId, artifact, version, base }: { endpointId: string; artifact: Artifact; version: ArtifactVersion; base: ArtifactVersion }) {
    const { t } = useTranslation('output');
    // Whichever of the two is on screen, the diff runs forward in time, so + is what the newer one added.
    const [older, newer] = base.number < version.number ? [base, version] : [version, base];
    const file = newer.files[0]!;
    const next = useArtifactText(endpointId, refOf(artifact, newer, 0), file);
    const old = useArtifactText(endpointId, refOf(artifact, older, 0), older.files[0]!);
    if (next.status === 'loading' || old.status === 'loading') {
        return <Centered busy>{t('view.loading')}</Centered>;
    }
    if (next.status === 'failed' || old.status === 'failed') {
        return <Centered icon={CircleAlert}>{t('view.readFailed')}</Centered>;
    }
    const patch = patchOf(old.text, next.text);
    const lines = patch.hunks.flatMap((hunk) => hunk.lines);
    const added = lines.filter((line) => line.kind === 'insert').length;
    const removed = lines.filter((line) => line.kind === 'delete').length;
    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-4 text-xs text-text-muted">
                <span
                    role="group"
                    aria-label={t('view.compareRange', { from: older.number, to: newer.number })}
                    className="flex min-w-0 items-center gap-1.5 tabular-nums"
                >
                    <span>{t('view.versionNumber', { number: older.number })}</span>
                    <Icon icon={ArrowRight} size={12} className="shrink-0" />
                    <span className="text-text">{t('view.versionNumber', { number: newer.number })}</span>
                </span>
                <span className="grow" />
                <span className="text-positive tabular-nums">+{added}</span>
                <span className="text-status-error tabular-nums">-{removed}</span>
            </div>
            {patch.hunks.length === 0 ? (
                <Centered icon={GitCompare}>{t('view.noChange')}</Centered>
            ) : (
                <ScrollArea axis="both" className="grow" viewportClassName="file-diff flex flex-col">
                    <LazyBoundary>
                        <UnifiedDiff
                            change={{ path: file.name, kind: 'update', diff: patch.text }}
                            contents={{ old: old.text, new: next.text }}
                            overflow="wrap"
                            fill
                        />
                    </LazyBoundary>
                </ScrollArea>
            )}
        </div>
    );
}

function ImagesBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    return (
        <ScrollArea axis="both" className="grow bg-surface-sunken" viewportClassName="flex flex-col items-center gap-4 p-4">
            {version.files.map((file, index) =>
                file.mime.startsWith('image/') ? (
                    <ArtifactImage key={index} endpointId={endpointId} reference={refOf(artifact, version, index)} name={file.name} />
                ) : null
            )}
        </ScrollArea>
    );
}

function ArtifactImage({ endpointId, reference, name }: { endpointId: string; reference: ArtifactFileRef; name: string }) {
    const bytes = useMachineUrl({ kind: 'artifact', ...reference }, endpointId);
    return bytes.url === null ? null : <img src={bytes.url} alt={name} className="max-w-full object-contain" />;
}

function FilesBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    const { t } = useTranslation('output');
    return (
        <ScrollArea className="grow" viewportClassName="flex flex-col px-6 py-6">
            <p className="mb-4 text-sm text-text-muted">{t('view.noPreview')}</p>
            <FileRows endpointId={endpointId} artifact={artifact} version={version} />
        </ScrollArea>
    );
}

function FileRows({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    const { t } = useTranslation('output');
    const download = (index: number): void => {
        downloadArtifactFile(endpointId, refOf(artifact, version, index), version.files[index]!).catch((error: unknown) =>
            useToasts.getState().show({ kind: 'error', title: t('view.downloadFailed'), description: messageOf(error) })
        );
    };
    return (
        <ul className="flex flex-col">
            {version.files.map((file, index) => (
                <li key={index} className="flex h-8 items-center gap-2 text-sm">
                    <span className="min-w-0 grow truncate text-text">{file.name}</span>
                    <span className="shrink-0 text-xs text-text-faint tabular-nums">{formatBytes(file.size)}</span>
                    {/* Without a shell that writes it in pieces, a download is read whole into this window first. */}
                    {!canDownload(file) ? (
                        <IconButton
                            icon={Download}
                            size="sm"
                            label={t('view.downloadTooLarge', { size: formatBytes(BYTES_READ_MAX_BYTES) })}
                            aria-disabled
                            onClick={() => undefined}
                        />
                    ) : (
                        <IconButton icon={Download} size="sm" label={t('view.download')} onClick={() => download(index)} />
                    )}
                </li>
            ))}
        </ul>
    );
}

/* Where the version on screen came from, as the machine recorded it, with its files, behind the bar's info button. */
function OriginPopover({
    endpointId,
    artifact,
    version,
    latest,
    chatPresent
}: {
    endpointId: string;
    artifact: Artifact;
    version: ArtifactVersion;
    latest: ArtifactVersion;
    chatPresent: boolean;
}) {
    const { t } = useTranslation('output');
    const provenance = version.provenance;
    const chatId = provenance.chatId;
    const chatName = useChatName(chatId);
    const listed = useChats((s) => chatId !== undefined && s.statusByKey[endpointKey(endpointId, chatId)] !== undefined);
    const present = chatName !== null || listed || (chatId !== undefined && chatId === latest.provenance.chatId && chatPresent);
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label ?? '');
    const originId = version.origin?.machineId;
    const origin = useEndpoints((s) =>
        originId === undefined ? null : (s.endpoints.find((entry) => entry.id === originId || entry.daemonId === originId)?.label ?? null)
    );
    return (
        <Popover.Root>
            <IconButton icon={Info} size="sm" label={t('view.info')} render={<Popover.Trigger />} />
            <Popover.Popup align="end" sideOffset={6} className="flex max-h-96 w-80 flex-col gap-5 overflow-y-auto p-4">
                <div className="flex flex-col gap-3">
                    <SectionLabel render={<h3 />}>{t('view.info')}</SectionLabel>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                        <InfoRow label={t('info.maker')}>
                            <Maker endpointId={endpointId} provenance={provenance} />
                        </InfoRow>
                        {chatId !== undefined && (
                            <InfoRow label={t('info.chat')}>
                                {chatName !== null ? (
                                    <Tooltip label={chatName === '' ? t('info.chatElsewhere') : chatName}>
                                        {/* A block, since an inline button as wide as its text overflows the row without an ellipsis. */}
                                        <button
                                            type="button"
                                            className="block max-w-full truncate text-left text-text hover:underline"
                                            onClick={() => showChat(chatId)}
                                        >
                                            {chatName === '' ? t('info.chatElsewhere') : chatName}
                                        </button>
                                    </Tooltip>
                                ) : present ? (
                                    t('info.chatElsewhere')
                                ) : (
                                    <span className="text-text-muted">{t('info.chatRemoved')}</span>
                                )}
                            </InfoRow>
                        )}
                        <InfoRow label={t('info.machine')}>{machine}</InfoRow>
                        {originId !== undefined && <InfoRow label={t('info.copiedFrom')}>{origin ?? t('info.otherMachine')}</InfoRow>}
                    </dl>
                    <p className="flex gap-2 rounded-md bg-surface-sunken px-3 py-2 text-xs text-text-muted">
                        <Icon icon={Lock} size={14} className="mt-0.5 shrink-0 text-text-faint" />
                        <span>{t('info.note')}</span>
                    </p>
                </div>
                <div className="flex flex-col gap-2">
                    <SectionLabel render={<h3 />}>{t('view.files')}</SectionLabel>
                    <FileRows endpointId={endpointId} artifact={artifact} version={version} />
                </div>
                {version.copiedTo.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <SectionLabel render={<h3 />}>{t('info.copiedTo')}</SectionLabel>
                        <ul className="flex flex-col gap-1 text-xs text-text-muted">
                            {version.copiedTo.map((path) => (
                                <li key={path} className="truncate font-mono">
                                    {path}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </Popover.Popup>
        </Popover.Root>
    );
}

/*
 * Who made a version: a person, a routine, or an agent by its CLI's mark and the model it ran, named
 * the way the machine's catalog names it. A version saved before the machine noted either says Agent.
 */
function Maker({ endpointId, provenance }: { endpointId: string; provenance: ArtifactProvenance }) {
    const { t } = useTranslation('output');
    const { agent, model } = provenance;
    if (provenance.maker !== 'agent' || (agent === undefined && model === undefined)) {
        return t(`info.makers.${provenance.maker}`);
    }
    // Without the CLI there is no catalog to name the model by, so its slug stands as it is.
    return agent === undefined ? <span className="truncate">{model}</span> : <AgentModelLabel provider={agent} model={model} scopeId={endpointId} />;
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <dt className="text-text-faint">{label}</dt>
            <dd className="min-w-0 truncate text-text">{children}</dd>
        </>
    );
}
