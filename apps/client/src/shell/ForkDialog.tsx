import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitFork } from 'lucide-react';
import { CHAT_FORK_TITLE_MAX, clipText, type ChatForkInfoResult, type ProviderInfo } from '@ruimte/contracts';
import { perform } from '@/actions/client-actions';
import { AccountDot, accountsOfKind, canContinueOn, topAccountEntry } from '@adecore/agents-react/providers';
import {
    EMPTY_DRAFT,
    writeDraft,
    useAccountChoice,
    type AccountChoice,
    branchRefusal,
    FORKABLE_PROVIDERS,
    forkPayload,
    forkPointLabel,
    forkPointOf,
    forkRefusal,
    forkShapes,
    type ForkCliChoice,
    type ForkShape,
    readChatPreferences,
    selectionFor
} from '@adecore/agents-react/chat';
import { useOtherMachines } from '@/canvas/use-other-machines';
import { forkOriginIn } from '@/chat/fork-origin';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { iconOfEntry } from '@/shell/settings/machine-icon';
import { nameOf } from '@/shell/settings/machine-list';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { endpointById } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { ModelPicker } from '@adecore/agents-react/chat/ui';
import { useProviders, useChatRow, knownAccounts, providerAccountsOf } from '@adecore/agents-react/state';
import { Switch, Button, ErrorBoundary, FieldHint, FormError, Icon, Input, Select, Dialog, messageOf } from '@adecore/ui';
import { useViewNodes } from '@/project/view-nodes';
import { useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';
import { useWorkspace } from '@/transport/connections';
import { useTransport } from '@/transport/context';
import { NodeMachineScope } from '@/transport/node-machine';

/*
 * Forks a chat after one of its turns, with the history up to and including that turn: a chat view
 * forks into a view listed after it, a node into a node beside it or, when picked, a view. The turn
 * is where the person clicked, so the dialog only says which one it is. A chat that runs on another
 * machine is read there, and its fork starts from a transcript the machine writes of it.
 */
export function ForkDialog() {
    const { t } = useTranslation('shell');
    const fork = useUi((s) => s.forkDialog);
    const close = (): void => useUi.getState().setForkDialog(null);
    return (
        <Dialog.Root open={fork !== null} onOpenChange={(open) => !open && close()}>
            <Dialog.Popup size="sm">
                <Dialog.Title className="flex items-center gap-2">
                    <Icon icon={GitFork} size={16} /> {t('fork.title')}
                </Dialog.Title>
                <ErrorBoundary label={t('fork.failedToRender')} resetKeys={[fork?.chatId, fork?.turnId]}>
                    {fork !== null && (
                        <NodeMachineScope machine={fork.machine}>
                            <ForkForm key={`${fork.chatId}:${fork.turnId}`} chatId={fork.chatId} turnId={fork.turnId} source={fork.machine} onDone={close} />
                        </NodeMachineScope>
                    )}
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function ForkForm({ chatId, turnId, source, onDone }: { chatId: string; turnId: string; source: string | undefined; onDone(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const info = useChatRow(chatId, (row) => row?.info ?? null);
    const items = useChatRow(chatId, (row) => row?.structure);
    const order = useChatRow(chatId, (row) => row?.order);
    const whole = useChatRow(chatId, (row) => row?.history === undefined);
    const origin = useViewNodes((views, nodesOf) => forkOriginIn(views, nodesOf, chatId)?.shape ?? 'node');
    const viewName = useViewNodes((views, nodesOf) => forkOriginIn(views, nodesOf, chatId)?.title);
    // A node's live editor names it before a save has brought the document up to date.
    const originalTitle = viewName ?? t('planPanel.chat');
    const nodeView = useViewNodes((views, nodesOf) => forkOriginIn(views, nodesOf, chatId)?.viewId ?? null);
    // A node of another machine goes on a canvas only you have, so a shared canvas offers no other machine.
    const sharedCanvas = useDocument((state) => nodeView !== null && state.shared.includes(nodeView));
    const machines = useOtherMachines();
    const [machineChoice, setMachineChoice] = useState('here');
    const remote = nodeView === null || sharedCanvas ? null : (machines.find((entry) => entry.id === machineChoice) ?? null);
    const shapes = forkShapes(origin);
    const [title, setTitle] = useState(clipText(t('fork.copyTitle', { title: originalTitle }), CHAT_FORK_TITLE_MAX));
    const [shape, setShape] = useState<ForkShape>(shapes[0]!);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const folder = useForkInfo(chatId, turnId);
    const [inWorktree, setInWorktree] = useState(true);
    const [branch, setBranch] = useState<string | null>(null);
    const [filesAfterTurn, setFilesAfterTurn] = useState(true);
    const [cli, setCli] = useState<ForkCliChoice | null>(null);
    const providers = useProviders((s) => s.providers);
    const endpointId = useEndpointId();
    const transport = useTransport();
    const workspace = useWorkspace();
    const projectFolder = useProject((s) => s.current?.folder ?? null);
    // The chat runs on another machine than the project's, so no fork of its conversation can be made here: a transcript of it is.
    const elsewhere = workspace !== null && endpointId !== workspace.connection.endpointId;

    const point = items && order ? forkPointOf(items, order, turnId, whole) : null;
    const refusal = forkRefusal(info, items?.[turnId]);
    const worktree = folder?.repository === true && inWorktree;
    const branchName = branch ?? folder?.branch ?? '';
    const branchProblem = worktree ? branchRefusal(branchName, folder.branches) : null;
    const originalCli: ForkCliChoice | null =
        info === null ? null : { provider: info.provider, selection: info.selection, account: info.account ?? info.provider };
    const chosenCli = cli ?? originalCli;
    const accountChoice = useAccountChoice(chosenCli?.provider ?? null, chosenCli?.account, chatId);
    const pickable = providers.filter((entry) => FORKABLE_PROVIDERS.has(entry.kind) && entry.installed && entry.capabilities.chat);
    const switching = chosenCli !== null && originalCli !== null && chosenCli.provider !== originalCli.provider;
    // Another account of the same CLI that does not read the original's conversation gets it handed over, as another CLI does.
    const handoff =
        switching ||
        (chosenCli !== null &&
            originalCli !== null &&
            accountChoice !== null &&
            !canContinueOn(accountChoice.accounts, chosenCli.provider, originalCli.account, chosenCli.account));
    /* The same CLI keeps the account picked here, another starts on the top account of its order. */
    const accountOn = (provider: ForkCliChoice['provider']): string => {
        if (provider === chosenCli?.provider && chosenCli.account !== undefined) {
            return chosenCli.account;
        }
        if (provider === originalCli?.provider && originalCli.account !== undefined) {
            return originalCli.account;
        }
        return topAccountEntry(accountsOfKind(knownAccounts(providerAccountsOf(endpointId)) ?? null, provider))?.id ?? provider;
    };
    const chooseCli = (provider: ForkCliChoice['provider'], model: string): void => {
        const remembered = provider === info?.provider ? info.selection : selectionFor(readChatPreferences(), provider);
        setCli({ provider, selection: remembered?.model === model ? remembered : { model, options: {} }, account: accountOn(provider) });
    };
    const ready = refusal === null && point !== null && title.trim() !== '' && (remote !== null || elsewhere || (folder !== null && branchProblem === null));

    const submit = async (): Promise<void> => {
        if (!ready || busy) {
            return;
        }
        if (remote !== null && nodeView !== null) {
            // The next dialog picks the checkout there and makes the chat; this one only hands it the turn.
            const original = defaultCanvases.peek(nodeView)?.getState().nodes[chatId];
            useUi.getState().setRemoteNodeDialog({
                machineId: remote.id,
                kind: 'chat',
                viewId: nodeView,
                at: original === undefined ? null : { x: original.x + original.w + 40, y: original.y },
                relink: false,
                handoff: {
                    chatId,
                    turnId,
                    title: title.trim(),
                    ...(info === null ? {} : { provider: info.provider }),
                    ...(elsewhere && source !== undefined ? { source } : {})
                }
            });
            onDone();
            return;
        }
        if (elsewhere) {
            await handOffHere();
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const payload = forkPayload({
                chatId,
                turnId,
                title: title.trim(),
                shape,
                worktree: worktree ? { branch: branchName.trim(), filesAfterTurn: filesAfterTurn && folder.filesAfterTurn } : null,
                ...(originalCli && chosenCli ? { cli: { original: originalCli, chosen: chosenCli } } : {})
            });
            await perform('chat.fork', {
                chatId,
                turnId,
                title: payload.title ?? null,
                branch: payload.worktree?.branch ?? null,
                asView: payload.asView ?? null,
                filesAfterTurn: payload.filesAfterTurn ?? null,
                provider: payload.provider ?? null,
                selection: payload.selection ?? null,
                account: payload.account ?? null
            });
            onDone();
        } catch (e) {
            setFailure(messageOf(e, t('fork.failed')));
        } finally {
            setBusy(false);
        }
    };

    /* A chat node on this canvas and this machine, seeded with what the chat's own machine writes of the conversation. */
    const handOffHere = async (): Promise<void> => {
        const canvas = nodeView === null ? null : (defaultCanvases.peek(nodeView) ?? null);
        if (canvas === null || projectFolder === null) {
            setFailure(t('fork.failed'));
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const answer = await transport.request('chat.handoff', {
                chatId,
                turnId,
                remote: { machine: endpointById(endpointId)?.label ?? endpointId, cwd: projectFolder }
            });
            const original = canvas.getState().nodes[chatId];
            const nodeId = canvas.getState().addNode('chat', original === undefined ? { x: 0, y: 0 } : { x: original.x + original.w + 40, y: original.y }, {
                title: title.trim(),
                ...(info === null ? {} : { provider: info.provider })
            });
            // Seeded, never sent: the person reads it and writes the first message, as for a fork onto another machine.
            if (nodeId !== null) {
                writeDraft(nodeId, { ...EMPTY_DRAFT, text: answer.text });
            }
            onDone();
        } catch (e) {
            setFailure(messageOf(e, t('fork.failed')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Dialog.Text className="mt-1">{point ? forkPointLabel(point) : t('fork.turnGone')}</Dialog.Text>
            {machines.length > 0 && nodeView !== null && !sharedCanvas && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{t('fork.machine')}</span>
                    <Select<string>
                        label={t('fork.machine')}
                        variant="outlined"
                        value={remote === null ? 'here' : remote.id}
                        onValueChange={setMachineChoice}
                        items={[
                            { value: 'here', label: t('fork.thisMachine') },
                            ...machines.map((entry) => ({
                                value: entry.id,
                                label: nameOf(entry),
                                icon: <MachineGlyph icon={iconOfEntry(entry, null)} size={14} />
                            }))
                        ]}
                    />
                </div>
            )}
            <Dialog.Text className="mt-2">
                {remote !== null
                    ? t('fork.onMachine', { machine: nameOf(remote) })
                    : elsewhere
                      ? t('fork.handoffHere')
                      : shape === 'view'
                        ? t('fork.intoView', { after: origin === 'view' ? t('fork.theOriginal') : t('fork.itsCanvas') })
                        : t('fork.intoNode')}
            </Dialog.Text>
            {remote === null && !elsewhere && chosenCli !== null && pickable.length > 0 && (
                <ForkCliFields
                    providers={pickable}
                    chosen={chosenCli}
                    accountChoice={accountChoice}
                    handoff={handoff}
                    onModel={chooseCli}
                    onAccount={(account) => setCli({ ...chosenCli, account })}
                />
            )}
            <label className="mt-3 block text-xs text-text-muted" htmlFor="fork-title">
                {t('fork.titleLabel')}
            </label>
            <Input
                id="fork-title"
                autoFocus
                className="mt-1"
                value={title}
                maxLength={CHAT_FORK_TITLE_MAX}
                spellCheck={false}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        void submit();
                    }
                }}
            />
            {remote === null && !elsewhere && shapes.length > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{t('fork.into')}</span>
                    <Select<ForkShape>
                        label={t('fork.into')}
                        variant="outlined"
                        value={shape}
                        onValueChange={setShape}
                        items={shapes.map((value) => ({ value, label: t(`fork.shapes.${value}`) }))}
                    />
                </div>
            )}
            {remote === null && !elsewhere && (
                <ForkFolder
                    folder={folder}
                    last={point?.last ?? true}
                    inWorktree={inWorktree}
                    onInWorktree={setInWorktree}
                    branch={branchName}
                    onBranch={setBranch}
                    branchProblem={branchProblem}
                    filesAfterTurn={filesAfterTurn}
                    onFilesAfterTurn={setFilesAfterTurn}
                    onSubmit={() => void submit()}
                />
            )}
            {refusal !== null && <p className="mt-2 text-sm text-text-muted">{refusal}.</p>}
            {failure && <FormError className="mt-2">{failure}</FormError>}
            <Dialog.Footer>
                <Button onClick={onDone}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
                    {busy ? t('fork.forking') : remote !== null ? t('fork.chooseCheckout') : t('fork.fork')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

/* What the machine says about the chat's folder; null while it is asked, and a machine that cannot say offers no worktree. */
function useForkInfo(chatId: string, turnId: string): ChatForkInfoResult | null {
    const transport = useTransport();
    const [folder, setFolder] = useState<ChatForkInfoResult | null>(null);
    useEffect(() => {
        let current = true;
        transport
            .request('chat.forkInfo', { chatId, turnId })
            .catch(() => ({ repository: false, branches: [], branch: null, filesAfterTurn: false }))
            .then((answer) => {
                if (current) {
                    setFolder(answer);
                }
            });
        return () => {
            current = false;
        };
    }, [transport, chatId, turnId]);
    return folder;
}

interface ForkCliFieldsProps {
    providers: ProviderInfo[];
    chosen: ForkCliChoice;
    accountChoice: AccountChoice | null;
    handoff: boolean;
    onModel(provider: ForkCliChoice['provider'], model: string): void;
    onAccount(account: string): void;
}

function ForkCliFields({ providers, chosen, accountChoice, handoff, onModel, onAccount }: ForkCliFieldsProps) {
    const { t } = useTranslation('shell');
    const [pickerOpen, setPickerOpen] = useState(false);
    return (
        <>
            <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-text-muted">{t('fork.continueWith')}</span>
                <ModelPicker
                    providers={providers}
                    provider={chosen.provider}
                    selection={chosen.selection}
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    onChange={onModel}
                />
            </div>
            {accountChoice !== null && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{t('fork.account')}</span>
                    <Select
                        label={t('fork.accountOf', { provider: accountChoice.providerName })}
                        variant="outlined"
                        value={accountChoice.currentId}
                        onValueChange={onAccount}
                        items={accountChoice.offered.map((entry) => ({
                            value: entry.id,
                            label: accountChoice.nameOf(entry),
                            icon: <AccountDot color={entry.account.color} />
                        }))}
                    />
                </div>
            )}
            {handoff && <FieldHint>{t('fork.handoffNote')}</FieldHint>}
        </>
    );
}

interface ForkFolderProps {
    folder: ChatForkInfoResult | null;
    last: boolean;
    inWorktree: boolean;
    onInWorktree(inWorktree: boolean): void;
    branch: string;
    onBranch(branch: string): void;
    branchProblem: string | null;
    filesAfterTurn: boolean;
    onFilesAfterTurn(filesAfterTurn: boolean): void;
    onSubmit(): void;
}

/*
 * Where the fork works: a worktree of its own (the default in a repository) whose files can start
 * from where the turn left them, or the original's folder, where nothing is put back.
 */
function ForkFolder({ folder, last, inWorktree, onInWorktree, branch, onBranch, branchProblem, filesAfterTurn, onFilesAfterTurn, onSubmit }: ForkFolderProps) {
    const { t } = useTranslation('shell');
    if (folder === null) {
        return <p className="mt-3 text-sm text-text-muted">{t('fork.lookingAtFolder')}</p>;
    }
    const sharedNote = last ? null : t('fork.sharedNote');
    if (!folder.repository) {
        return (
            <p className="mt-3 text-sm text-text-muted">
                {t('fork.noRepository')}
                {sharedNote === null ? '' : ` ${sharedNote}`}
            </p>
        );
    }
    return (
        <>
            <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-text">{t('fork.useWorktree')}</span>
                <Switch label={t('fork.useWorktree')} checked={inWorktree} onCheckedChange={onInWorktree} />
            </div>
            {inWorktree ? (
                <>
                    <label className="mt-2 block text-xs text-text-muted" htmlFor="fork-branch">
                        {t('fork.branch')}
                    </label>
                    <Input
                        id="fork-branch"
                        mono
                        className="mt-1"
                        value={branch}
                        spellCheck={false}
                        onChange={(e) => onBranch(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                                onSubmit();
                            }
                        }}
                    />
                    {branchProblem !== null && <FormError className="mt-1">{branchProblem}</FormError>}
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-sm text-text">{last ? t('fork.takeFiles') : t('fork.undoAfterTurn')}</span>
                        <Switch
                            label={last ? t('fork.takeFiles') : t('fork.undoAfterTurn')}
                            checked={filesAfterTurn && folder.filesAfterTurn}
                            disabled={!folder.filesAfterTurn}
                            onCheckedChange={onFilesAfterTurn}
                        />
                    </div>
                    <FieldHint>{!folder.filesAfterTurn ? t('fork.filesGone') : filesAfterTurn ? t('fork.fromTurnFiles') : t('fork.fromHead')}</FieldHint>
                </>
            ) : (
                sharedNote !== null && <p className="mt-2 text-sm text-text-muted">{sharedNote}</p>
            )}
        </>
    );
}
