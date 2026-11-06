import {
    Button,
    Checkbox,
    Icon,
    IconButton,
    Menu,
    ScrollArea,
    SplitButton,
    TextArea,
    Tooltip,
    KEY_SHORTCUTS,
    matchesShortcut,
    messageOf,
    isApplePlatform
} from '@adecore/ui';
import type { GitCapabilitiesResult } from '@ruimte/contracts';
import clsx from 'clsx';
import { ArrowUp, FolderGit2, LoaderCircle, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { cancelGitRunAction } from '@/action-port/person-actions';
import { useGit } from '@/state/git';
import { useToasts } from '@/state/toasts';
import { amendTarget, commitTargets, nextActionId, splitMessage, type CommitCandidate } from '@/worktree-rules/git-actions';
import { CommitSuggestion } from './commit-suggestion';

interface CommitBoxProps {
    /* Where the message being typed is kept: the project and not a repository, since one message
       commits whatever is staged and that can be more than one. */
    messageKey: string;
    checkouts: readonly CommitCandidate[];
    /* Whether the folder holds more than one repository, which is when a commit says where it lands. */
    named: boolean;
    capabilities: GitCapabilitiesResult | null;
    busy: boolean;
    onCommit(
        message: { subject: string; body: string },
        options: { targets: readonly CommitCandidate[]; stageAll: boolean; push: boolean; amend: boolean }
    ): void;
}

/*
 * The message, committed to every repository with something staged (one commit each, same words). With
 * nothing staged and a single repository changed, the button says it stages everything first.
 */
export function CommitBox({ messageKey, checkouts, named, capabilities, busy, onCommit }: CommitBoxProps) {
    const { t } = useTranslation('panels');
    const message = useGit((s) => s.messages[messageKey] ?? '');
    const version = useGit((s) => s.messageVersions[messageKey] ?? 0);
    const [offered, setOffered] = useState<{ key: string; source: string; message: string } | null>(null);
    const suggestions = useRef(new CommitSuggestion());
    const [writing, setWriting] = useState(false);
    const writingId = useRef<string | null>(null);
    const amendOn = useGit((s) => s.amends[messageKey] ?? false);
    const { targets, stageAll } = commitTargets(checkouts);
    /* An older machine would make a new commit of an amend it does not know, so it is offered only
       where the machine says it takes one. */
    const amendable = capabilities?.amend === true ? amendTarget(checkouts) : null;
    const amending = amendOn && amendable !== null;
    const changed = checkouts.some((checkout) => (checkout.status?.files.length ?? 0) > 0);
    const { subject, body } = splitMessage(message);
    const ready = subject !== '' && (amending || targets.length > 0) && !busy;
    /* A message is written from one repository's staged diff; over two there is no one diff to read. */
    const writeFrom = targets.length === 1 ? targets[0]!.path : null;
    const canWrite = capabilities !== null && capabilities.messageProvider !== null;

    const source = JSON.stringify(targets.map((target) => [target.path, target.revision, target.status?.files]));
    useLayoutEffect(() => {
        suggestions.current.observe({ key: messageKey, message, version, source });
    }, [messageKey, message, version, source]);
    useEffect(
        () => () => {
            suggestions.current.cancel();
            if (writingId.current !== null) {
                cancelGitRunAction(writingId.current);
                writingId.current = null;
            }
        },
        []
    );

    const cancelWriting = (): void => {
        suggestions.current.cancel();
        const running = writingId.current;
        writingId.current = null;
        setWriting(false);
        if (running !== null) {
            cancelGitRunAction(running);
        }
    };

    const commit = (push: boolean): void => {
        if (!ready) {
            return;
        }
        cancelWriting();
        setOffered(null);
        if (amending) {
            onCommit({ subject, body }, { targets: [amendable], stageAll: false, push: false, amend: true });
            return;
        }
        onCommit({ subject, body }, { targets, stageAll, push, amend: false });
    };

    /* An empty field starts from the last commit's subject, which is what an amend usually rewords. */
    const toggleAmend = (on: boolean): void => {
        useGit.getState().setAmend(messageKey, on);
        if (!on || amendable === null || message.trim() !== '') {
            return;
        }
        perform('git.log', { repository: amendable.path, limit: 1, cursor: null })
            .then((answer) => {
                const last = answer.commits[0]?.subject ?? '';
                const state = useGit.getState();
                if (last !== '' && state.amends[messageKey] === true && (state.messages[messageKey] ?? '') === '') {
                    state.setMessage(messageKey, last);
                }
            })
            .catch(() => undefined);
    };

    const write = (): void => {
        if (writing) {
            cancelWriting();
            return;
        }
        if (writeFrom === null) {
            return;
        }
        const actionId = nextActionId();
        const request = suggestions.current.begin();
        setOffered(null);
        writingId.current = actionId;
        setWriting(true);
        perform('git.suggestCommitMessage', { repository: writeFrom, run: actionId })
            .then((suggestion) => {
                const text = suggestion.body === '' ? suggestion.subject : `${suggestion.subject}\n\n${suggestion.body}`;
                // Read the store too: another panel may edit the draft before this component renders.
                const outcome = suggestions.current.finish(request, {
                    message: useGit.getState().messages[messageKey] ?? '',
                    version: useGit.getState().messageVersions[messageKey] ?? 0
                });
                if (outcome === 'apply') {
                    useGit.getState().setMessage(messageKey, text);
                } else if (outcome === 'offer') {
                    setOffered({ key: messageKey, source, message: text });
                }
            })
            .catch((error: unknown) => {
                if (writingId.current !== actionId) {
                    return;
                }
                const text = messageOf(error, t('git.commit.writeFailedBody'));
                useToasts.getState().show({ title: t('git.commit.writeFailedTitle'), description: text.split('\n')[0], kind: 'error', output: text });
            })
            .finally(() => {
                if (writingId.current === actionId) {
                    writingId.current = null;
                    setWriting(false);
                }
            });
    };

    const commitReason = amending ? t('git.commit.amendCommitHint') : stageAll ? t('git.commit.stageAllHint') : t('git.commit.commitStagedHint');
    const pushReason = amending
        ? t('git.commit.amendNoPush')
        : ready
          ? t('git.commit.commitAndPush')
          : targets.length === 0
            ? t('git.commit.needsStaged')
            : t('git.commit.needsMessage');

    return (
        <div className="flex shrink-0 flex-col gap-2 p-2">
            {named && (amending || targets.length > 0) && (
                <div className="flex items-center gap-1.5 px-1 text-xs text-text-muted">
                    <Icon icon={FolderGit2} size={12} className="shrink-0 text-text-faint" />
                    <span className="truncate">
                        {t('git.commit.in', { repos: amending ? amendable.label : targets.map((target) => target.label).join(', ') })}
                    </span>
                </div>
            )}
            <div className="flex flex-col rounded-lg border border-field-border bg-field bg-clip-padding has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:-outline-offset-1 has-[textarea:focus-visible]:outline-accent">
                <TextArea
                    variant="bare"
                    size="sm"
                    rows={3}
                    spellCheck={false}
                    aria-label={t('git.commit.label')}
                    placeholder={t('git.commit.placeholder')}
                    value={message}
                    onChange={(event) => useGit.getState().setMessage(messageKey, event.target.value)}
                    onKeyDown={(event) => {
                        if (matchesShortcut(KEY_SHORTCUTS.modEnter, event, isApplePlatform())) {
                            event.preventDefault();
                            commit(false);
                        }
                    }}
                />
                <div className="flex items-center gap-2 p-1.5">
                    {canWrite && (
                        <IconButton
                            icon={writing ? LoaderCircle : Sparkles}
                            size="sm"
                            className={clsx(writing && '[&_svg]:animate-spin')}
                            label={
                                writing
                                    ? t('git.commit.stopWriting')
                                    : writeFrom === null
                                      ? t('git.commit.writeOneRepo')
                                      : t('git.commit.letWrite', { provider: capabilities.messageProvider })
                            }
                            disabled={!changed || (writeFrom === null && !writing)}
                            onClick={write}
                        />
                    )}
                    {amendable !== null && (
                        <Tooltip label={t('git.commit.amendHint')}>
                            <label className="flex items-center gap-2 text-sm text-text">
                                <Checkbox label={t('git.commit.amend')} checked={amendOn} disabled={busy} onCheckedChange={toggleAmend} />
                                {t('git.commit.amend')}
                            </label>
                        </Tooltip>
                    )}
                    <span className="grow" />
                    <SplitButton
                        size="sm"
                        variant="primary"
                        tooltip={commitReason}
                        disabled={!ready}
                        onClick={() => commit(false)}
                        menuLabel={t('git.commit.more')}
                        menuTooltip={pushReason}
                        menuDisabled={!ready || amending}
                        menu={
                            <Menu.Item disabled={!ready || amending} onClick={() => commit(true)}>
                                <Icon icon={ArrowUp} size={14} /> {t('git.commit.commitAndPush')}
                            </Menu.Item>
                        }
                    >
                        {t('git.commit.commit')}
                    </SplitButton>
                </div>
            </div>
            {offered !== null && offered.key === messageKey && offered.source === source && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-clip-padding p-2">
                    <p className="text-xs text-text-muted">{t('git.commit.suggestionReady')}</p>
                    <ScrollArea render={<p />} className="max-h-32" viewportClassName="text-sm whitespace-pre-wrap text-text">
                        {offered.message}
                    </ScrollArea>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            onClick={() => {
                                useGit.getState().setMessage(messageKey, offered.message);
                                setOffered(null);
                            }}
                        >
                            {t('git.commit.useSuggestion')}
                        </Button>
                        <Button size="sm" onClick={() => setOffered(null)}>
                            {t('common:action.dismiss')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
