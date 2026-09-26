import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { GitFork } from 'lucide-react';
import { CHAT_FORK_TITLE_MAX, type ChatForkInfoResult } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import { AccountDot } from '@/agents/AccountDot';
import { canContinueOn } from '@/agents/accounts';
import { useAccountChoice } from '@/chat/account-choice';
import {
    branchRefusal,
    FORKABLE_PROVIDERS,
    forkOriginIn,
    forkPayload,
    forkPointLabel,
    forkPointOf,
    forkRefusal,
    forkShapes,
    type ForkCliChoice,
    type ForkShape
} from '@/chat/logic/fork';
import { accountFor, readChatPreferences, selectionFor } from '@/chat/preferences';
import { ModelPicker } from '@/chat/ui/Pickers';
import { useProviders } from '@/state/providers';
import { Toggle } from '@ruimte/ui/controls';
import { canvasOfNode } from '@/state/canvas';
import { useChatRow } from '@/state/chats';
import { useDocument } from '@/state/document';
import { useEndpointId } from '@/state/keys';
import { knownAccounts, providerAccountsOf } from '@/state/provider-accounts';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';
import { Button } from '@ruimte/ui/Button';
import { DIALOG_DESCRIPTION, DIALOG_FOOTER, FIELD_HINT, FORM_ERROR, SMALL_DIALOG } from '@ruimte/ui/classes';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { Icon } from '@ruimte/ui/Icon';
import { Select } from '@ruimte/ui/Select';

/*
 * Forks a chat after one of its turns, with the history up to and including that turn: a chat view
 * forks into a view listed after it, a node into a node beside it or, when picked, a view. The turn
 * is where the person clicked, so the dialog only says which one it is.
 */
export function ForkDialog() {
    const { t } = useTranslation('shell');
    const fork = useUi((s) => s.forkDialog);
    const close = (): void => useUi.getState().setForkDialog(null);
    return (
        <Dialog.Root
            open={fork !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className={SMALL_DIALOG}>
                    <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-text">
                        <Icon icon={GitFork} size={16} /> {t('fork.title')}
                    </Dialog.Title>
                    <ErrorBoundary label={t('fork.failedToRender')} resetKeys={[fork?.chatId, fork?.turnId]}>
                        {fork !== null && <ForkForm key={`${fork.chatId}:${fork.turnId}`} chatId={fork.chatId} turnId={fork.turnId} onDone={close} />}
                    </ErrorBoundary>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function ForkForm({ chatId, turnId, onDone }: { chatId: string; turnId: string; onDone(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const transport = useTransport();
    const info = useChatRow(chatId, (row) => row?.info ?? null);
    const items = useChatRow(chatId, (row) => row?.structure);
    const order = useChatRow(chatId, (row) => row?.order);
    const origin = useDocument((s) => forkOriginIn(s.views, chatId)?.shape ?? 'node');
    const viewName = useDocument((s) => forkOriginIn(s.views, chatId)?.title);
    // A node's live editor names it before a save has brought the document up to date.
    const originalTitle = canvasOfNode(chatId)?.getState().nodes[chatId]?.title ?? viewName ?? t('planPanel.chat');
    const shapes = forkShapes(origin);
    const [title, setTitle] = useState(t('fork.copyTitle', { title: originalTitle }).slice(0, CHAT_FORK_TITLE_MAX));
    const [shape, setShape] = useState<ForkShape>(shapes[0]!);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    // Null while the machine is asked; a machine that cannot say offers no worktree.
    const [folder, setFolder] = useState<ChatForkInfoResult | null>(null);
    const [inWorktree, setInWorktree] = useState(true);
    const [branch, setBranch] = useState<string | null>(null);
    const [filesAfterTurn, setFilesAfterTurn] = useState(true);
    const [cli, setCli] = useState<ForkCliChoice | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const providers = useProviders((s) => s.providers);
    const endpointId = useEndpointId();

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

    const point = items && order ? forkPointOf(items, order, turnId) : null;
    const refusal = forkRefusal(info, items?.[turnId]);
    const worktree = folder?.repository === true && inWorktree;
    const branchName = branch ?? folder?.branch ?? '';
    const branchProblem = worktree ? branchRefusal(branchName, folder.branches) : null;
    const originalCli: ForkCliChoice | null =
        info === null ? null : { provider: info.provider, selection: info.selection, account: info.account ?? info.provider };
    const chosenCli = cli ?? originalCli;
    const accountChoice = useAccountChoice(chosenCli?.provider ?? null, chosenCli?.account);
    const pickable = providers.filter((entry) => FORKABLE_PROVIDERS.has(entry.kind) && entry.installed && entry.capabilities.chat);
    const switching = chosenCli !== null && originalCli !== null && chosenCli.provider !== originalCli.provider;
    // Another account of the same CLI that does not read the original's conversation gets it handed over, as another CLI does.
    const handoff =
        switching ||
        (chosenCli !== null &&
            originalCli !== null &&
            accountChoice !== null &&
            !canContinueOn(accountChoice.accounts, chosenCli.provider, originalCli.account, chosenCli.account));
    /* The same CLI keeps the account picked here, another starts on the account picked for its new agents. */
    const accountOn = (provider: ForkCliChoice['provider']): string => {
        if (provider === chosenCli?.provider && chosenCli.account !== undefined) {
            return chosenCli.account;
        }
        if (provider === originalCli?.provider && originalCli.account !== undefined) {
            return originalCli.account;
        }
        return accountFor(readChatPreferences(), endpointId, provider, knownAccounts(providerAccountsOf(endpointId))) ?? provider;
    };
    const chooseCli = (provider: ForkCliChoice['provider'], model: string): void => {
        const remembered = provider === info?.provider ? info.selection : selectionFor(readChatPreferences(), provider);
        setCli({ provider, selection: remembered?.model === model ? remembered : { model, options: {} }, account: accountOn(provider) });
    };
    const ready = refusal === null && point !== null && title.trim() !== '' && folder !== null && branchProblem === null;

    const submit = async (): Promise<void> => {
        if (!ready || busy) {
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
            await performAsPerson('chat.fork', {
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
            setFailure(e instanceof Error ? e.message : t('fork.failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <p className={`${DIALOG_DESCRIPTION} mt-1`}>{point ? forkPointLabel(point) : t('fork.turnGone')}</p>
            <p className={`${DIALOG_DESCRIPTION} mt-2`}>
                {shape === 'view' ? t('fork.intoView', { after: origin === 'view' ? t('fork.theOriginal') : t('fork.itsCanvas') }) : t('fork.intoNode')}
            </p>
            {chosenCli !== null && pickable.length > 0 && (
                <>
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-text-muted">{t('fork.continueWith')}</span>
                        <ModelPicker
                            providers={pickable}
                            provider={chosenCli.provider}
                            selection={chosenCli.selection}
                            open={pickerOpen}
                            onOpenChange={setPickerOpen}
                            onChange={chooseCli}
                        />
                    </div>
                    {accountChoice !== null && (
                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-text-muted">{t('fork.account')}</span>
                            <Select
                                label={t('fork.accountOf', { provider: accountChoice.providerName })}
                                variant="outlined"
                                value={accountChoice.currentId}
                                onValueChange={(account) => setCli({ ...chosenCli, account })}
                                items={accountChoice.offered.map((entry) => ({
                                    value: entry.id,
                                    label: accountChoice.nameOf(entry),
                                    icon: <AccountDot color={entry.account.color} />
                                }))}
                            />
                        </div>
                    )}
                    {handoff && <p className={FIELD_HINT}>{t('fork.handoffNote')}</p>}
                </>
            )}
            <label className="mt-3 block text-xs text-text-muted" htmlFor="fork-title">
                {t('fork.titleLabel')}
            </label>
            <input
                id="fork-title"
                autoFocus
                className="field mt-1"
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
            {shapes.length > 1 && (
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
            {refusal !== null && <p className="mt-2 text-sm text-text-muted">{refusal}.</p>}
            {failure && (
                <p className={`${FORM_ERROR} mt-2`} role="alert">
                    {failure}
                </p>
            )}
            <div className={DIALOG_FOOTER}>
                <Button onClick={onDone}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
                    {busy ? t('fork.forking') : t('fork.fork')}
                </Button>
            </div>
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
                <Toggle label={t('fork.useWorktree')} checked={inWorktree} onChange={onInWorktree} />
            </div>
            {inWorktree ? (
                <>
                    <label className="mt-2 block text-xs text-text-muted" htmlFor="fork-branch">
                        {t('fork.branch')}
                    </label>
                    <input
                        id="fork-branch"
                        className="field mt-1 font-mono text-code"
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
                    {branchProblem !== null && (
                        <p className={`${FORM_ERROR} mt-1`} role="alert">
                            {branchProblem}
                        </p>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-sm text-text">{last ? t('fork.takeFiles') : t('fork.undoAfterTurn')}</span>
                        <Toggle
                            label={last ? t('fork.takeFiles') : t('fork.undoAfterTurn')}
                            checked={filesAfterTurn && folder.filesAfterTurn}
                            disabled={!folder.filesAfterTurn}
                            onChange={onFilesAfterTurn}
                        />
                    </div>
                    <p className={FIELD_HINT}>{!folder.filesAfterTurn ? t('fork.filesGone') : filesAfterTurn ? t('fork.fromTurnFiles') : t('fork.fromHead')}</p>
                </>
            ) : (
                sharedNote !== null && <p className="mt-2 text-sm text-text-muted">{sharedNote}</p>
            )}
        </>
    );
}
