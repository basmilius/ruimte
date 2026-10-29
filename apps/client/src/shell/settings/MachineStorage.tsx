import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Eraser, Folder, Package, Trash2 } from 'lucide-react';
import type { ArtifactCleanupProposal, ArtifactStorageResult } from '@ruimte/contracts';
import { Button, ErrorBoundary, SegmentBar } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';
import { SettingsRow, TopIcon } from '@adecore/ui/settings';
import { create } from 'zustand';
import { holdArtifacts, useArtifacts } from '@/output/artifacts';
import { OutputProjectGlyph } from '@/output/look';
import { showProjectOutput } from '@/output/open';
import { CleanupReviewDialog, type CleanupReview } from '@/shell/settings/panes/CleanupReviewDialog';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { machineTransport, pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';
import { isConnectionError } from '@/transport/transport';

// The categorical series of the theme, a project per color in the order of their size.
const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

/* The proposals a person put off with Not now, by `endpointKey(endpointId, proposalId)`; for as long as this page lives and nowhere else. */
const useDeferredProposals = create<{ deferred: ReadonlySet<string> }>(() => ({ deferred: new Set() }));

function deferProposal(key: string): void {
    useDeferredProposals.setState((state) => ({ deferred: new Set([...state.deferred, key]) }));
}

type StorageReading =
    | { status: 'loading' }
    | { status: 'unreachable' }
    | { status: 'tooOld' }
    | { status: 'failed' }
    | { status: 'ready'; storage: ArtifactStorageResult; proposals: ArtifactCleanupProposal[] };

const LOADING: StorageReading = { status: 'loading' };
const UNREACHABLE: StorageReading = { status: 'unreachable' };
const TOO_OLD: StorageReading = { status: 'tooOld' };

function changesOn(revisions: Readonly<Record<string, number>>, endpointId: string): number {
    const prefix = endpointKey(endpointId, '');
    let sum = 0;
    for (const [key, count] of Object.entries(revisions)) {
        if (key.startsWith(prefix)) {
            sum += count;
        }
    }
    return sum;
}

/* What one machine keeps and proposes to let go, read again whenever it says something in Output changed. */
function useStorage(endpointId: string, attempt: number): StorageReading {
    const connection = useEndpointConnection(endpointId);
    const open = connection.status === 'open';
    const answers = machineAnswers(connection, 'artifact.storage');
    const changes = useArtifacts((state) => changesOn(state.revisions, endpointId));
    const [held, setHeld] = useState<{ key: string; reading: StorageReading } | null>(null);

    useEffect(() => (answers ? holdArtifacts(endpointId, null) : undefined), [endpointId, answers]);

    useEffect(() => {
        if (!open || !answers) {
            return;
        }
        let live = true;
        const transport = machineTransport(endpointId);
        const proposals = machineAnswers(pool.statusOf(endpointId), 'artifact.cleanup')
            ? transport.request('artifact.cleanup', { mode: 'preview' }).then((result) => result.proposals ?? [])
            : Promise.resolve([]);
        Promise.all([transport.request('artifact.storage', {}), proposals])
            .then(([storage, list]) => {
                if (live) {
                    setHeld({ key: endpointId, reading: { status: 'ready', storage, proposals: list } });
                }
            })
            .catch((error: unknown) => {
                if (live) {
                    setHeld({ key: endpointId, reading: isConnectionError(error) ? UNREACHABLE : { status: 'failed' } });
                }
            });
        return () => {
            live = false;
        };
    }, [endpointId, open, answers, changes, attempt]);

    if (!open) {
        return connection.status === 'closed' || connection.attempts > 0 ? UNREACHABLE : LOADING;
    }
    if (!answers) {
        return TOO_OLD;
    }
    return held !== null && held.key === endpointId ? held.reading : LOADING;
}

/* What Ruimte keeps in Output on one machine, and the versions a person may let go: the Storage tab of its detail. */
export function MachineStorage({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');

    return (
        <ErrorBoundary label={t('storage.failed')} className="relative" compact>
            <StorageSections key={endpoint.id} endpoint={endpoint} />
        </ErrorBoundary>
    );
}

function StorageSections({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const [attempt, setAttempt] = useState(0);
    const reading = useStorage(endpoint.id, attempt);
    const machine = endpoint.label;
    const outputSection = (children: ReactNode) => (
        <SettingsSection title={t('storage.output.title')} description={t('storage.output.description')} icon={Package}>
            {children}
        </SettingsSection>
    );

    if (reading.status !== 'ready') {
        return outputSection(
            <SettingsRow
                searchId="machines.machine.storage.output"
                muted
                leading={reading.status === 'loading' ? undefined : <TopIcon icon={CircleAlert} className="text-text-faint" />}
                label={t(`storage.state.${reading.status}`, { machine })}
                control={
                    reading.status === 'failed' && (
                        <Button variant="secondary" onClick={() => setAttempt(attempt + 1)}>
                            {t('storage.state.retry')}
                        </Button>
                    )
                }
            />
        );
    }

    const { storage, proposals } = reading;
    const projects = [...storage.projects].sort((a, b) => b.bytes - a.bytes);
    return (
        <>
            {outputSection(
                <SettingsRow
                    searchId="machines.machine.storage.output"
                    label={t('storage.output.on', { machine })}
                    control={<span className="text-sm font-medium text-text tabular-nums">{formatBytes(storage.total.bytes)}</span>}
                >
                    <div className="flex flex-col gap-2 pt-2">
                        {storage.total.bytes > 0 && (
                            <SegmentBar
                                size="sm"
                                label={t('storage.output.bar')}
                                parts={projects.map((project, index) => ({
                                    value: project.bytes,
                                    label: `${project.projectName}, ${formatBytes(project.bytes)}`,
                                    color: SERIES[index % SERIES.length]
                                }))}
                            />
                        )}
                        {storage.disk !== null && (
                            <span className="text-xs text-text-faint tabular-nums">{t('storage.output.free', { size: formatBytes(storage.disk.free) })}</span>
                        )}
                    </div>
                </SettingsRow>
            )}
            <Proposals endpointId={endpoint.id} machine={machine} proposals={proposals} onRemoved={() => setAttempt(attempt + 1)} />
            <ByProject endpointId={endpoint.id} machine={machine} projects={projects} />
        </>
    );
}

function Proposals({
    endpointId,
    machine,
    proposals,
    onRemoved
}: {
    endpointId: string;
    machine: string;
    proposals: readonly ArtifactCleanupProposal[];
    onRemoved(): void;
}) {
    const { t } = useTranslation('settings');
    const deferred = useDeferredProposals((s) => s.deferred);
    const [review, setReview] = useState<CleanupReview | null>(null);
    const close = (): void => setReview(review === null ? null : { ...review, open: false });
    const shown = proposals.filter((proposal) => !deferred.has(endpointKey(endpointId, proposal.id)));
    return (
        <SettingsSection title={t('storage.cleanup.title')} description={t('storage.cleanup.description')} icon={Eraser}>
            {shown.length === 0 ? (
                <SettingsRow searchId="machines.machine.storage.cleanup" muted label={t('storage.cleanup.nothing')} />
            ) : (
                shown.map((proposal, index) => (
                    <SettingsRow
                        key={proposal.id}
                        searchId={index === 0 ? 'machines.machine.storage.cleanup' : undefined}
                        leading={<TopIcon icon={Trash2} className="text-text-faint" />}
                        label={t('storage.cleanup.proposal', { title: proposal.title })}
                        description={t('storage.cleanup.frees', { count: proposal.versions.length, size: formatBytes(proposal.bytes) })}
                        control={
                            <span className="flex items-center gap-2">
                                <Button variant="ghost" onClick={() => deferProposal(endpointKey(endpointId, proposal.id))}>
                                    {t('storage.cleanup.notNow')}
                                </Button>
                                <Button variant="secondary" onClick={() => setReview({ proposal, open: true, round: (review?.round ?? 0) + 1 })}>
                                    {t('storage.cleanup.review')}
                                </Button>
                            </span>
                        }
                    />
                ))
            )}
            <CleanupReviewDialog
                endpointId={endpointId}
                machine={machine}
                review={review}
                onClose={close}
                onRemoved={() => {
                    close();
                    onRemoved();
                }}
            />
        </SettingsSection>
    );
}

function ByProject({ endpointId, machine, projects }: { endpointId: string; machine: string; projects: ArtifactStorageResult['projects'] }) {
    const { t } = useTranslation('settings');
    const windowMachine = useEndpoints((s) => s.activeId);
    const inWorkspace = useProject((s) => s.current !== null);
    // The Output panel is the window's and lists the window's machine, so only that machine's projects can be shown in it.
    const showable = inWorkspace && windowMachine === endpointId;
    const show = (projectId: string): void => {
        useUi.getState().setSettings({ open: false });
        showProjectOutput(projectId);
    };
    return (
        <SettingsSection
            title={t('storage.projects.title')}
            icon={Folder}
            footer={
                <>
                    {t('storage.projects.footer')}
                    {!showable && projects.length > 0 && <span className="mt-1 block">{t('storage.projects.elsewhere', { machine })}</span>}
                </>
            }
        >
            {projects.length === 0 ? (
                <SettingsRow searchId="machines.machine.storage.projects" muted label={t('storage.projects.empty')} />
            ) : (
                projects.map((project, index) => (
                    <SettingsRow
                        key={project.projectId}
                        searchId={index === 0 ? 'machines.machine.storage.projects' : undefined}
                        leading={
                            <span className="flex h-5.5 items-center">
                                <OutputProjectGlyph endpointId={endpointId} projectId={project.projectId} size={16} />
                            </span>
                        }
                        label={
                            <span className="flex min-w-0 items-center gap-2">
                                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SERIES[index % SERIES.length] }} />
                                <span className="truncate">{project.projectName}</span>
                            </span>
                        }
                        description={t('storage.projects.counts', {
                            artifacts: t('storage.projects.artifacts', { count: project.artifacts }),
                            versions: t('storage.projects.versions', { count: project.versions })
                        })}
                        control={
                            <span className="flex items-center gap-2">
                                <span className="text-sm text-text-muted tabular-nums">{formatBytes(project.bytes)}</span>
                                {showable && (
                                    <Button variant="secondary" onClick={() => show(project.projectId)}>
                                        {t('storage.projects.show')}
                                    </Button>
                                )}
                            </span>
                        }
                    />
                ))
            )}
        </SettingsSection>
    );
}
