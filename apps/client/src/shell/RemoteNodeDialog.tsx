import { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import type { DeviceInfo, ProjectNode } from '@ruimte/contracts';
import { EMPTY_DRAFT, rememberChatSelection, writeDraft } from '@adecore/agents-react/chat';
import { deleteNodesAction } from '@/actions/client-actions';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { handOff } from '@/project/bundle-transfer';
import { linkToPeerOrMark } from '@/project/peer-linker';
import { remoteMirrorsOf } from '@/project/remote-mirror';
import { createRemoteNode } from '@/project/remote-node';
import { strandedBy } from '@/project/remote-relink';
import { nodesOfView } from '@/project/view-nodes';
import type { RemoteCandidate } from '@/project/remote-candidates';
import { describeLastSeen } from '@/shell/connection-info';
import { RemoteFolderPicker } from '@/shell/RemoteFolderPicker';
import { useCheckoutState, useRemoteCheckouts, type CheckoutState, useRemoteDevices } from '@/shell/use-remote-checkouts';
import { useWorktreeStart } from '@/shell/use-worktree-start';
import { WorktreeStartFields } from '@/shell/WorktreeStartFields';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { machineIdOf, nameOf } from '@/shell/settings/machine-list';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { endpointById, endpointIdOfMachine, useEndpointIdOfMachine, useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useUi, type RemoteNodeRequest } from '@/state/ui';
import { remoteMirror, useWorkspace } from '@/transport/connections';
import { NodeMachineScope } from '@/transport/node-machine';
import { transportFor } from '@/transport';
import { machineAnswers, useMachineAnswers } from '@/transport/features';
import { useLastSeenAt } from '@/transport/status';
import { formatBytes } from '@adecore/ui/format';
import { Button, Dialog, ErrorBoundary, FieldHint, FormError, Icon, Select, Skeleton, Switch, messageOf, useNow } from '@adecore/ui';

type Kind = RemoteNodeRequest['kind'];

/* Where the node starts: the files of this checkout, its HEAD, the other machine's checkout as it is, or a branch both reach through origin. */
type StartFrom = 'files' | 'head' | 'machine' | 'origin';

const KINDS: readonly Kind[] = ['chat', 'terminal', 'device'];
const MINUTE_MS = 60_000;

/*
 * A node of a canvas that works in a checkout on another machine, or that machine linked to this
 * project again after it stopped. The node is made last: the machine is linked, the project saved
 * with the node, and only then does the other machine hear of it.
 */
export function RemoteNodeDialog() {
    const request = useUi((s) => s.remoteNodeDialog);
    const close = (): void => useUi.getState().setRemoteNodeDialog(null);
    return (
        <Dialog.Root
            open={request !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Popup size="sm">
                {request !== null && <RemoteNodeBody key={`${request.machineId}:${request.viewId}:${request.relink}`} request={request} onDone={close} />}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function RemoteNodeBody({ request, onDone }: { request: RemoteNodeRequest; onDone(): void }) {
    const { t } = useTranslation(['shell', 'canvas']);
    const endpointId = useEndpointIdOfMachine(request.machineId);
    const entry = useMachineEntry(endpointId);
    const icon = useMachineIcon(entry);
    const machine = nameOf(entry);
    const [kind, setKind] = useState<Kind>(request.kind);
    // The scope needs the row, which asking for the machine makes; until then nothing under it reads another machine.
    const row = useEndpoints((state) => state.endpoints.some((candidate) => candidate.id === endpointId));
    return (
        <>
            <Dialog.Title className="flex items-center gap-2">
                <MachineGlyph icon={icon} size={16} />
                {request.relink
                    ? t('remoteNode.relinkTitle', { machine })
                    : t('remoteNode.title', { kind: t(`shell:nodeKinds.${kind}`).toLowerCase(), machine })}
            </Dialog.Title>
            <ErrorBoundary label={t('remoteNode.failedToRender')} resetKeys={[request.machineId]}>
                <NodeMachineScope key={row ? 'row' : 'pending'} machine={request.machineId}>
                    <RemoteNodeForm request={request} machine={machine} kind={kind} onKind={setKind} onDone={onDone} />
                </NodeMachineScope>
            </ErrorBoundary>
        </>
    );
}

function RemoteNodeForm({
    request,
    machine,
    kind,
    onKind,
    onDone
}: {
    request: RemoteNodeRequest;
    machine: string;
    kind: Kind;
    onKind(kind: Kind): void;
    onDone(): void;
}) {
    const { t } = useTranslation(['shell', 'common']);
    const workspace = useWorkspace();
    const project = useProject((s) => s.current);
    const here = workspace?.connection.transport ?? null;
    const machineEndpointId = useEndpointIdOfMachine(request.machineId);
    const lastSeen = useLastSeenAt(machineEndpointId);
    const now = useNow(MINUTE_MS);
    const { checkouts, retry } = useRemoteCheckouts(request.machineId, project?.projectId ?? null, project?.folder ?? null, here);
    const [picked, setPicked] = useState<string | null>(null);
    const [chosen, setChosen] = useState<RemoteCandidate[]>([]);
    const [browsing, setBrowsing] = useState(false);
    const [opening, setOpening] = useState(false);
    const [inWorktree, setInWorktree] = useState(false);
    const [deviceKey, setDeviceKey] = useState<string | null>(null);
    const [startChoice, setStartChoice] = useState<StartFrom | null>(null);
    const [sending, setSending] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const { devices, failed: devicesFailed } = useRemoteDevices(request.machineId, kind === 'device' && !request.relink);

    const candidates =
        checkouts.state === 'ready'
            ? [...checkouts.candidates, ...chosen.filter((own) => !checkouts.candidates.some((known) => known.folder === own.folder))]
            : [];
    // Linking again starts from the checkout the nodes there work in, when that machine still has it.
    const linkedFolder = request.relink && checkouts.state === 'ready' ? checkouts.linkedFolder : null;
    const candidate =
        candidates.find((entry) => entry.projectId === picked) ?? candidates.find((entry) => entry.folder === linkedFolder) ?? candidates[0] ?? null;
    const scoped = useMemo(() => endpointById(machineEndpointId) !== null, [machineEndpointId]);
    const hereId = workspace?.connection.endpointId ?? '';
    const canSign = useMachineAnswers(hereId, 'endpoint.signPeerAccess');
    const canConnect = useMachineAnswers(hereId, 'remote.connect');
    // Both ends have to know the requests of the link: this one signs and connects, and that one takes the tasks a link is for.
    const canTake = useMachineAnswers(machineEndpointId, 'peer.taskStart');
    const canLink = canSign && canConnect && canTake;
    const bundlesHere = useMachineAnswers(workspace?.connection.endpointId ?? '', 'git.bundle');
    const bundlesThere = useMachineAnswers(machineEndpointId, 'git.fetchBundle');
    const clonesThere = useMachineAnswers(machineEndpointId, 'git.clone');
    const listsHere = useMachineAnswers(hereId, 'git.ignoredFiles');
    const canClone = clonesThere && listsHere;
    const checkout = useCheckoutState(here, project?.folder ?? null, !request.relink && kind !== 'device' && bundlesHere && bundlesThere);
    const options = startOptions(
        checkout,
        bundlesHere && bundlesThere && kind !== 'device',
        checkouts.state === 'ready' ? checkouts.here?.remoteUrl !== undefined : false,
        candidate?.remoteUrl != null
    );
    const startFrom: StartFrom = startChoice !== null && options.includes(startChoice) ? startChoice : options.includes('files') ? 'files' : 'machine';
    const ownWorktree = startFrom === 'machine' && inWorktree;
    const start = useWorktreeStart(ownWorktree && scoped && candidate !== null ? candidate.folder : null);
    const device =
        devices?.find((entry) => `${entry.backendId}:${entry.deviceId}` === (deviceKey ?? `${devices[0]?.backendId}:${devices[0]?.deviceId}`)) ?? null;
    const needsDevice = kind === 'device' && !request.relink;
    const ready = candidate !== null && !busy && (!ownWorktree || (start !== null && start.ready)) && (!needsDevice || device !== null);

    const open = async (folder: string): Promise<void> => {
        setOpening(true);
        setFailure(null);
        try {
            const there = transportFor(machineEndpointId)!;
            const opened = await there.request('project.open', { folder });
            // Looking at a folder does not keep its project open there.
            void there.request('project.release', { projectId: opened.summary.projectId }).catch(() => undefined);
            const { identities } = machineAnswers(there.connection, 'git.identity')
                ? await there.request('git.identity', { paths: [opened.summary.folder] }).catch(() => ({ identities: [] }))
                : { identities: [] };
            const identity = identities[0];
            const known = identity === undefined || 'error' in identity ? null : identity;
            const ours = new Set(checkouts.state === 'ready' ? (checkouts.here?.rootCommits ?? []) : []);
            const next: RemoteCandidate = {
                projectId: opened.summary.projectId,
                name: opened.summary.name,
                folder: opened.summary.folder,
                same: known?.rootCommits.some((commit) => ours.has(commit)) ?? false,
                branch: known?.branch ?? null,
                heads: known?.heads ?? [],
                remoteUrl: known?.remoteUrl ?? null
            };
            setChosen((before) => [...before.filter((entry) => entry.folder !== next.folder), next]);
            setPicked(next.projectId);
            setBrowsing(false);
        } catch (e) {
            setFailure(messageOf(e, t('remoteNode.folders.failed', { machine })));
        } finally {
            setOpening(false);
        }
    };

    const submit = async (): Promise<void> => {
        if (!ready || candidate === null || checkouts.state !== 'ready' || project === null || workspace === null) {
            return;
        }
        const there = transportFor(machineEndpointId)!;
        const self = endpointById(workspace.connection.endpointId);
        const selfId = self === null ? workspace.connection.endpointId : machineIdOf(self);
        const link = {
            projectId: project.projectId,
            machineId: request.machineId,
            remoteProjectId: candidate.projectId,
            label: machine,
            rootCommit: checkouts.here?.rootCommits[0] ?? ''
        };
        setBusy(true);
        setFailure(null);
        try {
            if (request.relink) {
                const cwds = (remoteMirrorsOf(useDocument.getState().views, nodesOfView, selfId).get(request.machineId)?.nodes ?? []).flatMap((node) =>
                    node.cwd === undefined ? [] : [node.cwd]
                );
                const stranded = strandedBy(candidate.folder, checkouts.linkedFolder, cwds);
                if (stranded !== null) {
                    setFailure(t('remoteNode.relinkStranded', { machine, folder: stranded }));
                    return;
                }
                await there.request('peer.bind', { machineId: selfId, label: self?.label ?? selfId, projectId: candidate.projectId });
                await workspace.connection.transport.request('remote.link', link);
                await remoteMirror()?.relink(request.machineId, candidate.projectId);
                onDone();
                return;
            }
            const canvas = request.viewId === null ? null : defaultCanvases.peek(request.viewId);
            let handoffText: string | null = null;
            const placeCheckout = async (): Promise<string | null> => {
                const branch = checkout?.branch ?? null;
                if (startFrom === 'files' || startFrom === 'head') {
                    const sent = await handOff({
                        from: workspace.connection.transport,
                        to: there,
                        bundle: {
                            path: project.folder,
                            from: startFrom,
                            haves: candidate.heads,
                            name: `Handoff of ${branch ?? 'HEAD'} from ${self?.label ?? selfId}`
                        },
                        projectId: candidate.projectId,
                        branch: branch ?? 'handoff',
                        into: 'worktree',
                        machine: self?.label ?? selfId,
                        onSize: setSending
                    });
                    return sent.path ?? null;
                }
                if (startFrom === 'origin' && branch !== null) {
                    await workspace.connection.transport.request('git.action', {
                        cwd: project.folder,
                        actionId: crypto.randomUUID(),
                        kind: checkout?.upstream === true ? 'push' : 'publish'
                    });
                    await there.request('git.action', { cwd: candidate.folder, actionId: crypto.randomUUID(), kind: 'fetch' });
                    const { worktree } = await there.request('git.worktree-add', {
                        repo: candidate.folder,
                        branch: `ruimte/${branch}`,
                        projectId: candidate.projectId,
                        base: `origin/${branch}`
                    });
                    return worktree.path;
                }
                if (!ownWorktree || start === null) {
                    return null;
                }
                const { worktree } = await there.request('git.worktree-add', {
                    repo: candidate.folder,
                    branch: start.branch.trim(),
                    projectId: candidate.projectId,
                    ...(start.reuses ? {} : { base: start.base.trim() })
                });
                return worktree.path;
            };
            const linked = checkouts.links.some((known) => known.machineId === request.machineId && known.remoteProjectId === candidate.projectId);
            await createRemoteNode({
                linked,
                bindThere: async () => {
                    await there.request('peer.bind', { machineId: selfId, label: self?.label ?? selfId, projectId: candidate.projectId });
                },
                linkHere: async () => {
                    await workspace.connection.transport.request('remote.link', link);
                },
                makeWorktree: async () => {
                    const path = await placeCheckout();
                    if (request.handoff !== undefined) {
                        // The machine the original runs on is the one that holds its conversation.
                        const { source } = request.handoff;
                        const from = source === undefined ? workspace.connection.transport : transportFor(endpointIdOfMachine(source));
                        if (from === null) {
                            throw new Error(t('remoteNode.sourceGone'));
                        }
                        const answer = await from.request('chat.handoff', {
                            chatId: request.handoff.chatId,
                            turnId: request.handoff.turnId,
                            remote: {
                                machine: source === undefined ? (self?.label ?? selfId) : (endpointById(endpointIdOfMachine(source))?.label ?? source),
                                cwd: path ?? candidate.folder
                            }
                        });
                        handoffText = answer.text;
                    }
                    return path;
                },
                addNode: (cwd) => {
                    if (canvas === null) {
                        return null;
                    }
                    if (start !== null && start.provider !== null && start.selection !== null && kind === 'chat') {
                        rememberChatSelection(start.provider, start.selection);
                    }
                    const nodeId = canvas.getState().addNode(kind, request.at ?? { x: 0, y: 0 }, {
                        machine: request.machineId,
                        cwd: cwd ?? candidate.folder,
                        ...(request.handoff === undefined ? {} : { title: request.handoff.title }),
                        ...(kind === 'chat' ? { provider: request.handoff?.provider ?? start?.provider ?? 'claude', providerFixed: true } : {}),
                        ...(kind === 'device' && device !== null ? { device: deviceReference(device) } : {})
                    });
                    // Seeded, never sent: the person reads it and writes the first message, as for a fork on this machine.
                    if (nodeId !== null && handoffText !== null) {
                        writeDraft(nodeId, { ...EMPTY_DRAFT, text: handoffText });
                    }
                    return nodeId;
                },
                removeNode: (nodeId) => {
                    if (canvas !== null) {
                        deleteNodesAction(canvas, [nodeId]);
                    }
                },
                save: () => workspace.connection.projects.flush(),
                holdMirror: () => remoteMirror()?.hold() ?? ((): void => undefined)
            });
            onDone();
            // Once the node exists the dialog is done. The node works without the link between the machines, which only lets agents give tasks there, so it goes on after the dialog and marks the machine when the account cannot vouch for it.
            if (!linked && canLink) {
                void linkToPeerOrMark(request.machineId, workspace.connection.transport);
            }
        } catch (e) {
            setFailure(messageOf(e, t('remoteNode.failed')));
        } finally {
            setBusy(false);
            setSending(null);
        }
    };

    return (
        <>
            <Dialog.Text className="mt-1">
                {request.relink
                    ? t('remoteNode.relinkIntro', { machine })
                    : request.handoff !== undefined
                      ? t('remoteNode.handoffIntro', { machine, title: request.handoff.title })
                      : t(kind === 'chat' ? 'remoteNode.intro' : 'remoteNode.introOther', { kind: t(`shell:nodeKinds.${kind}`).toLowerCase(), machine })}
            </Dialog.Text>
            {!request.relink && request.handoff === undefined && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{t('remoteNode.kind')}</span>
                    <Select<Kind>
                        label={t('remoteNode.kind')}
                        variant="outlined"
                        value={kind}
                        onValueChange={onKind}
                        items={KINDS.map((value) => ({ value, label: t(`shell:nodeKinds.${value}`) }))}
                    />
                </div>
            )}
            <div className="mt-3 text-xs text-text-muted">{t('remoteNode.checkout')}</div>
            {browsing ? (
                <RemoteFolderPicker endpointId={machineEndpointId} machine={machine} onPick={(folder) => void open(folder)} onBack={() => setBrowsing(false)} />
            ) : (
                <CheckoutField
                    checkouts={checkouts}
                    candidates={candidates}
                    candidate={candidate}
                    machine={machine}
                    seen={describeLastSeen(lastSeen, now)}
                    opening={opening}
                    onPick={setPicked}
                    onChoose={() => setBrowsing(true)}
                    onClone={
                        canClone
                            ? () => {
                                  onDone();
                                  useUi.getState().setAddToMachineDialog({ machineId: request.machineId, then: request });
                              }
                            : null
                    }
                    onRetry={retry}
                />
            )}
            {!request.relink && candidate !== null && !browsing && (
                <>
                    {kind === 'device' && <DeviceField machine={machine} devices={devices} failed={devicesFailed} value={device} onPick={setDeviceKey} />}
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-text-muted">{t('remoteNode.startFrom')}</span>
                        <Select<StartFrom>
                            label={t('remoteNode.startFrom')}
                            variant="outlined"
                            value={startFrom}
                            onValueChange={setStartChoice}
                            items={options.map((value) => ({ value, label: startLabel(t, value, machine, checkout) }))}
                        />
                    </div>
                    {(startFrom === 'files' || startFrom === 'head' || startFrom === 'origin') && (
                        <FieldHint className="mt-1">{t(`remoteNode.start.${startFrom}Hint`, { machine, branch: checkout?.branch ?? '' })}</FieldHint>
                    )}
                    {kind !== 'device' && startFrom === 'machine' && (
                        <>
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <span className="text-sm text-text">{t('remoteNode.worktree', { machine })}</span>
                                <Switch label={t('remoteNode.worktree', { machine })} checked={inWorktree} onCheckedChange={setInWorktree} />
                            </div>
                            {inWorktree && start !== null && <WorktreeStartFields start={start} idPrefix="remote-node" onSubmit={() => void submit()} />}
                        </>
                    )}
                </>
            )}
            {failure && <FormError className="mt-2">{failure}</FormError>}
            <Dialog.Footer>
                <Button onClick={onDone}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={!ready || browsing} onClick={() => void submit()}>
                    {request.relink
                        ? busy
                            ? t('remoteNode.linking')
                            : t('remoteNode.link')
                        : busy
                          ? sending === null
                              ? t('remoteNode.creating')
                              : t('remoteNode.sending', { size: formatBytes(sending) })
                          : t('remoteNode.create')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

/* The choices in the order the dialog lists them; the checkout's own files only when there are some. */
function startOptions(checkout: CheckoutState | null, bundles: boolean, remoteHere: boolean, remoteThere: boolean): StartFrom[] {
    if (!bundles || checkout === null) {
        return ['machine'];
    }
    return [
        ...(checkout.changed > 0 ? (['files'] as const) : []),
        ...(checkout.branch !== null ? (['head'] as const) : []),
        'machine',
        ...(checkout.branch !== null && remoteHere && remoteThere ? (['origin'] as const) : [])
    ];
}

function startLabel(t: TFunction<['shell', 'common']>, value: StartFrom, machine: string, checkout: CheckoutState | null): string {
    const branch = checkout?.branch ?? 'HEAD';
    switch (value) {
        case 'files':
            return t('remoteNode.start.files', { branch, count: checkout?.changed ?? 0 });
        case 'head':
            return t('remoteNode.start.head', { branch });
        case 'origin':
            return t('remoteNode.start.origin');
        default:
            return t('remoteNode.asItIs', { machine });
    }
}

function deviceReference(device: DeviceInfo): NonNullable<ProjectNode['device']> {
    return { platform: device.platform, kind: device.kind, name: device.name, runtime: device.runtime };
}

interface CheckoutFieldProps {
    checkouts: ReturnType<typeof useRemoteCheckouts>['checkouts'];
    candidates: RemoteCandidate[];
    candidate: RemoteCandidate | null;
    machine: string;
    seen: string | null;
    opening: boolean;
    onPick(projectId: string): void;
    onChoose(): void;
    /* Puts this project on that machine first; null when one of the two machines cannot. */
    onClone: (() => void) | null;
    onRetry(): void;
}

/* The four states of the checkout: looking, found, none, and a machine that does not answer. */
function CheckoutField({ checkouts, candidates, candidate, machine, seen, opening, onPick, onChoose, onClone, onRetry }: CheckoutFieldProps) {
    const { t } = useTranslation('shell');
    if (checkouts.state === 'loading') {
        return (
            <div className="mt-1 flex flex-col gap-2" role="status">
                <Skeleton className="w-3/4" />
                <span className="text-sm text-text-muted">{t('remoteNode.looking', { machine })}</span>
            </div>
        );
    }
    if (checkouts.state === 'error') {
        return (
            <div className="mt-1 flex flex-col gap-2">
                <FormError>{t('remoteNode.unreachable', { machine })}</FormError>
                {seen !== null && <span className="text-xs text-text-muted">{seen}</span>}
                <div>
                    <Button size="sm" variant="secondary" onClick={onRetry}>
                        {t('remoteNode.retry')}
                    </Button>
                </div>
            </div>
        );
    }
    if (candidate === null) {
        return (
            <div className="mt-1 flex flex-col gap-2">
                <span className="text-sm text-text-muted">{t('remoteNode.none')}</span>
                <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={opening} onClick={onChoose}>
                        {opening ? t('remoteNode.folders.opening') : t('remoteNode.choose')}
                    </Button>
                    {onClone !== null && (
                        <Button size="sm" variant="secondary" onClick={onClone}>
                            {t('remoteNode.clone', { machine })}
                        </Button>
                    )}
                </div>
            </div>
        );
    }
    return (
        <div className="mt-1 flex flex-col gap-1">
            {candidates.length > 1 ? (
                <Select<string>
                    label={t('remoteNode.checkout')}
                    variant="outlined"
                    value={candidate.projectId}
                    onValueChange={onPick}
                    items={candidates.map((entry) => ({ value: entry.projectId, label: entry.folder }))}
                />
            ) : (
                <span className="truncate font-mono text-sm text-text">{candidate.folder}</span>
            )}
            <FieldHint>{candidate.same ? t('remoteNode.sameRepository') : t('remoteNode.otherRepository')}</FieldHint>
            <div>
                <Button size="sm" variant="ghost" disabled={opening} onClick={onChoose}>
                    {opening ? t('remoteNode.folders.opening') : t('remoteNode.choose')}
                </Button>
            </div>
        </div>
    );
}

function DeviceField({
    machine,
    devices,
    failed,
    value,
    onPick
}: {
    machine: string;
    devices: DeviceInfo[] | null;
    failed: boolean;
    value: DeviceInfo | null;
    onPick(key: string): void;
}) {
    const { t } = useTranslation('shell');
    if (failed) {
        return <FormError className="mt-3">{t('remoteNode.devices.failed', { machine })}</FormError>;
    }
    if (devices === null) {
        return <p className="mt-3 text-sm text-text-muted">{t('remoteNode.devices.looking', { machine })}</p>;
    }
    if (devices.length === 0) {
        return <p className="mt-3 text-sm text-text-muted">{t('remoteNode.devices.none', { machine })}</p>;
    }
    return (
        <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-text-muted">{t('remoteNode.device')}</span>
            <Select<string>
                label={t('remoteNode.device')}
                variant="outlined"
                value={value === null ? null : `${value.backendId}:${value.deviceId}`}
                onValueChange={onPick}
                items={devices.map((entry) => ({
                    value: `${entry.backendId}:${entry.deviceId}`,
                    label: `${entry.name} · ${entry.runtime}`,
                    icon: <Icon icon={Server} size={14} />
                }))}
            />
        </div>
    );
}
