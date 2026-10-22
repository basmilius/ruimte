import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitIgnoredFilesResult } from '@ruimte/contracts';
import { ensureMachine } from '@/endpoint/reach';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { useOtherMachines } from '@/canvas/use-other-machines';
import {
    copyCandidates,
    copyIgnoredFiles,
    protocolOf,
    remoteUrlAs,
    repositoryName,
    type CopyCandidate,
    type CopyOutcome,
    type RemoteProtocol
} from '@/project/add-to-machine';
import { RemoteFolderPicker } from '@/shell/RemoteFolderPicker';
import { iconOfEntry } from '@/shell/settings/machine-icon';
import { nameOf } from '@/shell/settings/machine-list';
import { endpointById } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useUi, type AddToMachineRequest } from '@/state/ui';
import { pool, transportFor } from '@/transport';
import { useWorkspace } from '@/transport/connections';
import { machineAnswers } from '@/transport/features';
import type { Transport } from '@/transport/transport';
import { formatBytes } from '@adecore/ui/format';
import { Button, Checkbox, Dialog, ErrorBoundary, FieldHint, FormError, Input, Meter, Segmented, Select, Skeleton, messageOf } from '@adecore/ui';

const PROTOCOLS: readonly RemoteProtocol[] = ['ssh', 'https'];

/* What this project is as a repository: where its top level is, its ignored files and the remote a clone comes from. */
type Source = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; listed: GitIgnoredFilesResult; remoteUrl: string | null };

type Step =
    | { step: 'form' }
    | { step: 'cloning'; line: string; percent: number | null }
    | { step: 'failed'; message: string }
    | { step: 'files'; clone: string }
    | { step: 'copying'; clone: string; done: number; total: number }
    | { step: 'done'; clone: string; outcomes: CopyOutcome[] };

/*
 * A project put on another machine of the account: that machine clones the repository from its remote,
 * and the files git ignores here that a person picks (`.env` and the like) are copied over by this
 * client, read here and written there. The machines never talk to each other for it.
 */
export function AddToMachineDialog() {
    const request = useUi((s) => s.addToMachineDialog);
    const close = (): void => useUi.getState().setAddToMachineDialog(null);
    return (
        <Dialog.Root
            open={request !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Popup size="sm">{request !== null && <AddToMachineBody request={request} onDone={close} />}</Dialog.Popup>
        </Dialog.Root>
    );
}

function AddToMachineBody({ request, onDone }: { request: AddToMachineRequest; onDone(): void }) {
    const { t } = useTranslation('shell');
    return (
        <>
            <Dialog.Title>{t('addToMachine.title')}</Dialog.Title>
            <ErrorBoundary label={t('addToMachine.failedToRender')} resetKeys={[request.machineId]}>
                <AddToMachineForm request={request} onDone={onDone} />
            </ErrorBoundary>
        </>
    );
}

/* What this project's machine says about the checkout, read once when the dialog opens. */
function useSource(here: Transport | null, folder: string | null): Source {
    const [source, setSource] = useState<Source>({ state: 'loading' });
    useEffect(() => {
        if (here === null || folder === null) {
            return;
        }
        let current = true;
        void (async () => {
            try {
                const listed = await here.request('git.ignoredFiles', { cwd: folder });
                const { identities } = await here.request('git.identity', { paths: [listed.root] });
                const identity = identities[0];
                const remoteUrl = identity === undefined || 'error' in identity ? null : (identity.remoteUrl ?? null);
                if (current) {
                    setSource({ state: 'ready', listed, remoteUrl });
                }
            } catch (e) {
                if (current) {
                    setSource({ state: 'failed', message: messageOf(e) });
                }
            }
        })();
        return () => {
            current = false;
        };
    }, [here, folder]);
    return source;
}

/* The other machine's link, brought up and held while the dialog looks at it. */
function useMachineLink(machineId: string | null): { there: Transport | null; endpointId: string | null; failed: boolean } {
    const [link, setLink] = useState<{ machineId: string; there: Transport | null; endpointId: string | null; failed: boolean } | null>(null);
    useEffect(() => {
        if (machineId === null) {
            return;
        }
        const controller = new AbortController();
        let release: (() => void) | null = null;
        void ensureMachine(machineId, controller.signal).then(
            (endpointId) => {
                const endpoint = endpointById(endpointId);
                release = endpoint === null ? null : pool.hold(endpoint);
                if (!controller.signal.aborted) {
                    setLink({ machineId, there: transportFor(endpointId), endpointId, failed: false });
                }
            },
            () => {
                if (!controller.signal.aborted) {
                    setLink({ machineId, there: null, endpointId: null, failed: true });
                }
            }
        );
        return () => {
            controller.abort();
            release?.();
        };
    }, [machineId]);
    return link === null || link.machineId !== machineId ? { there: null, endpointId: null, failed: false } : link;
}

// `Receiving objects:  45% (450/1000)`: git's own count of the step it is in.
function percentOf(line: string): number | null {
    const match = /(\d{1,3})%/.exec(line);
    return match === null ? null : Number(match[1]);
}

function AddToMachineForm({ request, onDone }: { request: AddToMachineRequest; onDone(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const workspace = useWorkspace();
    const project = useProject((s) => s.current);
    const here = workspace?.connection.transport ?? null;
    const machines = useOtherMachines();
    const [machineId, setMachineId] = useState<string | null>(request.machineId ?? machines[0]?.id ?? null);
    const entry = machines.find((candidate) => candidate.id === machineId) ?? null;
    const machine = entry === null ? '' : nameOf(entry);
    const { there, endpointId, failed: unreachable } = useMachineLink(machineId);
    const source = useSource(here, project?.folder ?? null);
    const [parent, setParent] = useState<string | null>(null);
    const [browsing, setBrowsing] = useState(false);
    const [name, setName] = useState<string | null>(null);
    const [protocolChoice, setProtocolChoice] = useState<RemoteProtocol | null>(null);
    const [step, setStep] = useState<Step>({ step: 'form' });
    const [actionId, setActionId] = useState<string | null>(null);
    const [checked, setChecked] = useState<Set<string> | null>(null);

    const remoteUrl = source.state === 'ready' ? source.remoteUrl : null;
    const protocol = protocolChoice ?? (remoteUrl === null ? 'ssh' : (protocolOf(remoteUrl) ?? 'ssh'));
    const url = remoteUrl === null ? null : remoteUrlAs(remoteUrl, protocol);
    const folderName = name ?? (remoteUrl === null ? '' : repositoryName(remoteUrl));
    const prefix = source.state === 'ready' ? source.listed.prefix : '';
    // Only what lies in this project's folder, the one the clone is opened as and so the one its writes may reach.
    const candidates = source.state === 'ready' ? copyCandidates(source.listed).filter((file) => prefix === '' || file.path.startsWith(`${prefix}/`)) : [];
    const projectFolderIn = (clone: string): string => (prefix === '' ? clone : `${clone}/${prefix}`);
    const picked = checked ?? new Set(candidates.filter((file) => file.checked).map((file) => file.path));
    const clones = there !== null && machineAnswers(there.connection, 'git.clone');
    const lists = here !== null && machineAnswers(here.connection, 'git.ignoredFiles');
    const filled = clones && url !== null && parent !== null && folderName.trim() !== '' && !folderName.includes('/');

    useEffect(() => {
        if (there === null || actionId === null) {
            return;
        }
        return there.on('git.progress', (event) => {
            if (event.actionId === actionId && event.phase === 'fetch' && event.line !== '') {
                setStep((before) => (before.step === 'cloning' ? { step: 'cloning', line: event.line, percent: percentOf(event.line) } : before));
            }
        });
    }, [there, actionId]);

    const clone = async (): Promise<void> => {
        if (!filled || there === null || url === null || parent === null) {
            return;
        }
        const id = crypto.randomUUID();
        setActionId(id);
        setStep({ step: 'cloning', line: '', percent: null });
        try {
            const cloned = await there.request('git.clone', { actionId: id, url, path: `${parent.replace(/\/+$/, '')}/${folderName.trim()}` });
            // Opened once so the machine lists it among its projects, and let go at once like any folder only looked at.
            const opened = await there.request('project.open', { folder: projectFolderIn(cloned.path) }).catch(() => null);
            if (opened !== null) {
                void there.request('project.release', { projectId: opened.summary.projectId }).catch(() => undefined);
            }
            setStep({ step: 'files', clone: cloned.path });
        } catch (e) {
            setStep({ step: 'failed', message: messageOf(e, t('addToMachine.cloneFailed', { machine })) });
        } finally {
            setActionId(null);
        }
    };

    const cancel = (): void => {
        if (step.step === 'cloning' && actionId !== null) {
            void there?.request('git.cancel', { actionId }).catch(() => undefined);
            return;
        }
        onDone();
    };

    const copy = async (clone: string): Promise<void> => {
        if (there === null || here === null || source.state !== 'ready') {
            return;
        }
        const chosen = candidates.filter((file) => picked.has(file.path));
        if (chosen.length === 0) {
            setStep({ step: 'done', clone, outcomes: [] });
            return;
        }
        setStep({ step: 'copying', clone, done: 0, total: chosen.length });
        // Writing there needs the clone open as a project of this client, which is the boundary of a write.
        const opened = await there.request('project.open', { folder: projectFolderIn(clone) }).catch(() => null);
        try {
            const outcomes = await copyIgnoredFiles(
                chosen,
                source.listed.root,
                clone,
                {
                    read: (path) => here.request('fs.read', { path }),
                    write: async (path, text, mode) => {
                        await there.request('fs.create', { path, kind: 'file', text, overwrite: true, mode });
                    },
                    // `fs.create` takes a `mode` from the release that brought `git.clone`; an older machine drops it and writes 0644.
                    keepsMode: machineAnswers(there.connection, 'git.clone')
                },
                (done) => setStep({ step: 'copying', clone, done, total: chosen.length })
            );
            setStep({ step: 'done', clone, outcomes });
        } finally {
            if (opened !== null) {
                void there.request('project.release', { projectId: opened.summary.projectId }).catch(() => undefined);
            }
        }
    };

    const proceed = (): void => {
        onDone();
        if (request.then !== undefined) {
            useUi.getState().setRemoteNodeDialog(request.then);
        }
    };

    const toggle = (file: CopyCandidate, on: boolean): void => {
        const next = new Set(picked);
        if (on) {
            next.add(file.path);
        } else {
            next.delete(file.path);
        }
        setChecked(next);
    };

    if (step.step === 'files') {
        return (
            <>
                <Dialog.Text className="mt-1">{t('addToMachine.files.intro', { machine })}</Dialog.Text>
                <FileList candidates={candidates} picked={picked} truncated={source.state === 'ready' && source.listed.truncated} onToggle={toggle} />
                <Dialog.Footer>
                    <Button onClick={() => setStep({ step: 'done', clone: step.clone, outcomes: [] })}>{t('addToMachine.files.skip')}</Button>
                    <Button variant="primary" disabled={picked.size === 0} onClick={() => void copy(step.clone)}>
                        {t('addToMachine.files.copy', { count: picked.size })}
                    </Button>
                </Dialog.Footer>
            </>
        );
    }
    if (step.step === 'copying') {
        return (
            <>
                <div className="mt-3 flex flex-col gap-2" role="status">
                    <Meter value={step.done} max={step.total} label={t('addToMachine.copying', { done: step.done, total: step.total })} />
                    <span className="text-sm text-text-muted">{t('addToMachine.copying', { done: step.done, total: step.total })}</span>
                </div>
                <Dialog.Footer>
                    <Button variant="primary" disabled>
                        {t('addToMachine.files.copy', { count: step.total })}
                    </Button>
                </Dialog.Footer>
            </>
        );
    }
    if (step.step === 'done') {
        return (
            <>
                <Summary machine={machine} clone={step.clone} outcomes={step.outcomes} />
                <Dialog.Footer>
                    {request.then !== undefined && <Button onClick={onDone}>{t('common:action.close')}</Button>}
                    <Button variant="primary" onClick={proceed}>
                        {request.then === undefined ? t('common:action.close') : t('addToMachine.continue')}
                    </Button>
                </Dialog.Footer>
            </>
        );
    }

    const cloning = step.step === 'cloning';
    return (
        <>
            <Dialog.Text className="mt-1">{t('addToMachine.intro')}</Dialog.Text>
            {!lists && here !== null && <FormError className="mt-3">{t('addToMachine.updateHere')}</FormError>}
            <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-text-muted">{t('addToMachine.machine')}</span>
                {machines.length === 0 ? (
                    <span className="text-sm text-text-muted">{t('addToMachine.noMachines')}</span>
                ) : (
                    <Select<string>
                        label={t('addToMachine.machine')}
                        variant="outlined"
                        value={machineId}
                        disabled={cloning}
                        onValueChange={(next) => {
                            setMachineId(next);
                            setParent(null);
                            setBrowsing(false);
                        }}
                        items={machines.map((candidate) => ({
                            value: candidate.id,
                            label: nameOf(candidate),
                            icon: <MachineGlyph icon={iconOfEntry(candidate, null)} size={14} />
                        }))}
                    />
                )}
            </div>
            {unreachable && <FormError className="mt-2">{t('addToMachine.unreachable', { machine })}</FormError>}
            {there !== null && !clones && <FormError className="mt-2">{t('addToMachine.updateThere', { machine })}</FormError>}
            <div className="mt-3 text-xs text-text-muted">{t('addToMachine.folder', { machine })}</div>
            {browsing && endpointId !== null ? (
                <RemoteFolderPicker
                    endpointId={endpointId}
                    machine={machine}
                    onPick={(folder) => {
                        setParent(folder);
                        setBrowsing(false);
                    }}
                    onBack={() => setBrowsing(false)}
                />
            ) : (
                <div className="mt-1 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                        <span className={parent === null ? 'text-sm text-text-muted' : 'truncate font-mono text-sm text-text'}>
                            {parent === null ? t('addToMachine.noFolder') : parent}
                        </span>
                        <Button size="sm" variant="secondary" disabled={there === null || cloning} onClick={() => setBrowsing(true)}>
                            {t('addToMachine.chooseFolder')}
                        </Button>
                    </div>
                    <Input
                        mono
                        aria-label={t('addToMachine.name')}
                        value={folderName}
                        disabled={cloning}
                        spellCheck={false}
                        onChange={(e) => setName(e.target.value)}
                    />
                    {parent !== null && folderName.trim() !== '' && (
                        <FieldHint>{t('addToMachine.into', { path: `${parent.replace(/\/+$/, '')}/${folderName.trim()}` })}</FieldHint>
                    )}
                </div>
            )}
            <SourceField source={source} url={url} protocol={protocol} disabled={cloning} onProtocol={setProtocolChoice} />
            {cloning && (
                <div className="mt-3 flex flex-col gap-1" role="status">
                    <Meter value={step.percent} label={t('addToMachine.cloning', { machine })} />
                    <span className="truncate font-mono text-xs text-text-muted">{step.line === '' ? t('addToMachine.cloning', { machine }) : step.line}</span>
                </div>
            )}
            {step.step === 'failed' && <FormError className="mt-3 break-words">{step.message}</FormError>}
            <Dialog.Footer>
                <Button onClick={cancel}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={!filled || browsing || cloning} onClick={() => void clone()}>
                    {step.step === 'failed' ? t('addToMachine.retry') : cloning ? t('addToMachine.cloningShort') : t('addToMachine.clone')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

/* The remote the clone comes from, in the protocol picked: loading, no remote at all, or the URL. */
function SourceField({
    source,
    url,
    protocol,
    disabled,
    onProtocol
}: {
    source: Source;
    url: string | null;
    protocol: RemoteProtocol;
    disabled: boolean;
    onProtocol(protocol: RemoteProtocol): void;
}) {
    const { t } = useTranslation('shell');
    if (source.state === 'loading') {
        return (
            <div className="mt-3 flex flex-col gap-2" role="status">
                <Skeleton className="w-3/4" />
                <span className="text-sm text-text-muted">{t('addToMachine.reading')}</span>
            </div>
        );
    }
    if (source.state === 'failed') {
        return <FormError className="mt-3">{t('addToMachine.notARepository', { message: source.message })}</FormError>;
    }
    if (url === null) {
        return <FormError className="mt-3">{t('addToMachine.noRemote')}</FormError>;
    }
    return (
        <div className="mt-3 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-text-muted">{t('addToMachine.remote')}</span>
                <Segmented
                    value={protocol}
                    options={PROTOCOLS.map((id) => ({ id, label: t(`addToMachine.protocols.${id}`) }))}
                    onValueChange={onProtocol}
                    label={t('addToMachine.remote')}
                    disabled={disabled}
                />
            </div>
            <FieldHint className="truncate font-mono">{url}</FieldHint>
        </div>
    );
}

function FileList({
    candidates,
    picked,
    truncated,
    onToggle
}: {
    candidates: CopyCandidate[];
    picked: Set<string>;
    truncated: boolean;
    onToggle(file: CopyCandidate, on: boolean): void;
}) {
    const { t } = useTranslation('shell');
    if (candidates.length === 0) {
        return <p className="mt-3 text-sm text-text-muted">{t('addToMachine.files.none')}</p>;
    }
    return (
        <>
            <ul className="mt-3 max-h-64 overflow-auto rounded-md border border-border" aria-label={t('addToMachine.files.label')}>
                {candidates.map((file) => (
                    <li key={file.path}>
                        <label className="flex items-center gap-2 px-2 py-1 text-sm">
                            <Checkbox
                                checked={picked.has(file.path)}
                                disabled={file.skip !== null}
                                label={file.path}
                                onCheckedChange={(on) => onToggle(file, on)}
                            />
                            <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                            <span className="shrink-0 text-xs text-text-muted">
                                {file.skip === null ? formatBytes(file.size) : t(`addToMachine.skip.${file.skip}`)}
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
            {truncated && <FieldHint className="mt-1">{t('addToMachine.files.truncated')}</FieldHint>}
        </>
    );
}

/* What was copied and what was not, with the reason for each file left behind. */
function Summary({ machine, clone, outcomes }: { machine: string; clone: string; outcomes: CopyOutcome[] }) {
    const { t } = useTranslation('shell');
    const copied = outcomes.filter((outcome) => outcome.copied).length;
    const missed = outcomes.filter((outcome) => !outcome.copied);
    return (
        <div className="mt-1 flex flex-col gap-2">
            <Dialog.Text>{t('addToMachine.done', { machine, path: clone })}</Dialog.Text>
            <span className="text-sm text-text">{t('addToMachine.copied', { count: copied })}</span>
            {missed.length > 0 && (
                <ul className="max-h-48 overflow-auto rounded-md border border-border" aria-label={t('addToMachine.notCopied')}>
                    {missed.map((outcome) => (
                        <li key={outcome.path} className="flex items-center justify-between gap-3 px-2 py-1 text-sm">
                            <span className="min-w-0 truncate font-mono">{outcome.path}</span>
                            <span className="shrink-0 text-xs text-text-muted">
                                {outcome.copied
                                    ? ''
                                    : outcome.reason === 'failed'
                                      ? (outcome.message ?? t('addToMachine.skip.failed'))
                                      : t(`addToMachine.skip.${outcome.reason}`)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
