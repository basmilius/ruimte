import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderGit2, LoaderCircle, Sparkles } from 'lucide-react';
import type { GitCapabilitiesResult } from '@ruimte/contracts';
import { Button, Icon, TextArea, Tooltip, KEY_SHORTCUTS, matchesShortcut } from '@adecore/ui';
import { cancelGitRunAction, performAsPerson } from '@/actions/client-actions';
import { commitTargets, nextActionId, splitMessage, type CommitCandidate } from '@/shell/panels/git-actions';
import { CommitSuggestion } from './commit-suggestion';
import { useGit } from '@/state/git';
import { useToasts } from '@/state/toasts';
import { isApplePlatform } from '@/desktop/bridge';

interface CommitBoxProps {
    /* Where the message being typed is kept: the project and not a repository, since one message
       commits whatever is staged and that can be more than one. */
    messageKey: string;
    checkouts: readonly CommitCandidate[];
    /* Whether the folder holds more than one repository, which is when a commit says where it lands. */
    named: boolean;
    capabilities: GitCapabilitiesResult | null;
    busy: boolean;
    onCommit(message: { subject: string; body: string }, options: { targets: readonly CommitCandidate[]; stageAll: boolean; push: boolean }): void;
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
    const { targets, stageAll } = commitTargets(checkouts);
    const changed = checkouts.some((checkout) => (checkout.status?.files.length ?? 0) > 0);
    const { subject, body } = splitMessage(message);
    const ready = subject !== '' && targets.length > 0 && !busy;
    /* A message is written from one repository's staged diff; over two there is no one diff to read. */
    const writeFrom = targets.length === 1 ? targets[0]!.path : null;

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
        if (ready) {
            cancelWriting();
            setOffered(null);
            onCommit({ subject, body }, { targets, stageAll, push });
        }
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
        performAsPerson('git.suggestCommitMessage', { repository: writeFrom, run: actionId })
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
                const text = error instanceof Error ? error.message : t('git.commit.writeFailedBody');
                useToasts.getState().show({ title: t('git.commit.writeFailedTitle'), description: text.split('\n')[0], kind: 'error', output: text });
            })
            .finally(() => {
                if (writingId.current === actionId) {
                    writingId.current = null;
                    setWriting(false);
                }
            });
    };

    return (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border p-2">
            {named && targets.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Icon icon={FolderGit2} size={12} className="shrink-0 text-text-faint" />
                    <span className="truncate">{t('git.commit.in', { repos: targets.map((target) => target.label).join(', ') })}</span>
                </div>
            )}
            <TextArea
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
            {offered !== null && offered.key === messageKey && offered.source === source && (
                <div className="flex flex-col gap-2 rounded-md border border-border p-2">
                    <p className="text-xs text-text-muted">{t('git.commit.suggestionReady')}</p>
                    <p className="max-h-32 overflow-auto text-sm whitespace-pre-wrap text-text">{offered.message}</p>
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
            <div className="flex flex-wrap items-center gap-2">
                {capabilities !== null && capabilities.messageProvider !== null && (
                    <Tooltip
                        label={
                            writing
                                ? t('git.commit.stopWriting')
                                : writeFrom === null
                                  ? t('git.commit.writeOneRepo')
                                  : t('git.commit.letWrite', { provider: capabilities.messageProvider })
                        }
                    >
                        <Button size="sm" disabled={!changed || (writeFrom === null && !writing)} onClick={write}>
                            <Icon icon={writing ? LoaderCircle : Sparkles} size={12} className={writing ? 'animate-spin' : undefined} />
                            {writing ? t('git.commit.writing') : t('git.commit.write')}
                        </Button>
                    </Tooltip>
                )}
                <span className="grow" />
                <Tooltip label={ready ? t('git.commit.commitAndPushHint') : targets.length === 0 ? t('git.commit.needsStaged') : t('git.commit.needsMessage')}>
                    <Button size="sm" variant="secondary" disabled={!ready} onClick={() => commit(true)}>
                        {t('git.commit.commitAndPush')}
                    </Button>
                </Tooltip>
                <Tooltip label={stageAll ? t('git.commit.stageAllHint') : t('git.commit.commitStagedHint')}>
                    <Button size="sm" variant="primary" disabled={!ready} onClick={() => commit(false)}>
                        {stageAll ? t('git.commit.stageAllAndCommit') : t('git.commit.commit')}
                    </Button>
                </Tooltip>
            </div>
        </div>
    );
}
