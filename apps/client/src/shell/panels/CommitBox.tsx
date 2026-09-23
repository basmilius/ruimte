import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderGit2, LoaderCircle, Sparkles } from 'lucide-react';
import type { GitCapabilitiesResult } from '@ruimte/contracts';
import { COMMIT_MESSAGE } from '@/ui/classes';
import { cancelGitRunAction, performAsPerson } from '@/actions/client-actions';
import { commitTargets, nextActionId, splitMessage, type CommitCandidate } from '@/shell/panels/git-actions';
import { useGit } from '@/state/git';
import { useToasts } from '@/state/toasts';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { isApplePlatform } from '@/desktop/bridge';
import { KEY_SHORTCUTS, matchesShortcut } from '@/ui/shortcut';

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
 * What is committed and what it is called. The staged files say where it lands, so a message typed
 * here commits every repository that has something staged, and two repositories staged at once are
 * two commits with the same message. Nothing staged is not a dead end while a single repository has
 * changes: the button then says it stages everything first, which is the commit a person means when
 * they typed a message with only unstaged work in front of them.
 */
export function CommitBox({ messageKey, checkouts, named, capabilities, busy, onCommit }: CommitBoxProps) {
    const { t } = useTranslation('panels');
    const message = useGit((s) => s.messages[messageKey] ?? '');
    const [writing, setWriting] = useState(false);
    const writingId = useRef<string | null>(null);
    const { targets, stageAll } = commitTargets(checkouts);
    const changed = checkouts.some((checkout) => (checkout.status?.files.length ?? 0) > 0);
    const { subject, body } = splitMessage(message);
    const ready = subject !== '' && targets.length > 0 && !busy;
    /* A message is written from one repository's staged diff; over two there is no one diff to read. */
    const writeFrom = targets.length === 1 ? targets[0]!.path : null;

    const commit = (push: boolean): void => {
        if (ready) {
            onCommit({ subject, body }, { targets, stageAll, push });
        }
    };

    const write = (): void => {
        if (writing) {
            const running = writingId.current;
            if (running !== null) {
                cancelGitRunAction(running);
            }
            return;
        }
        if (writeFrom === null) {
            return;
        }
        const actionId = nextActionId();
        writingId.current = actionId;
        setWriting(true);
        performAsPerson('git.suggestCommitMessage', { repository: writeFrom, run: actionId })
            .then((suggestion) => {
                useGit.getState().setMessage(messageKey, suggestion.body === '' ? suggestion.subject : `${suggestion.subject}\n\n${suggestion.body}`);
            })
            .catch((error: unknown) => {
                const text = error instanceof Error ? error.message : t('git.commit.writeFailedBody');
                useToasts.getState().show({ title: t('git.commit.writeFailedTitle'), description: text.split('\n')[0], kind: 'error', output: text });
            })
            .finally(() => {
                writingId.current = null;
                setWriting(false);
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
            <textarea
                className={COMMIT_MESSAGE}
                rows={3}
                spellCheck={false}
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
