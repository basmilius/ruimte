import { useRef, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import type { GitCapabilitiesResult, GitStatus } from '@ruimte/contracts';
import { COMMIT_MESSAGE } from '@/shell/panels/classes';
import { splitMessage } from '@/shell/panels/git-actions';
import { nextActionId } from '@/shell/panels/use-git-actions';
import { useGit } from '@/state/git';
import { useToasts } from '@/state/toasts';
import { transport } from '@/transport';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface CommitBoxProps {
    cwd: string;
    status: GitStatus | null;
    capabilities: GitCapabilitiesResult | null;
    busy: boolean;
    onCommit(message: { subject: string; body: string }, options: { stageAll: boolean; push: boolean }): void;
}

/*
 * What is committed and what it is called. Nothing staged is not a dead end: the button then says
 * it stages everything first, which is the commit a person means when they typed a message with
 * only unstaged work in front of them.
 */
export function CommitBox({ cwd, status, capabilities, busy, onCommit }: CommitBoxProps) {
    const message = useGit((s) => s.messages[cwd] ?? '');
    const [writing, setWriting] = useState(false);
    const writingId = useRef<string | null>(null);
    const staged = status?.files.some((file) => file.state === 'staged') ?? false;
    const changed = (status?.files.length ?? 0) > 0;
    const { subject, body } = splitMessage(message);
    const ready = subject !== '' && changed && !busy;

    const commit = (push: boolean): void => {
        if (ready) {
            onCommit({ subject, body }, { stageAll: !staged, push });
        }
    };

    const write = (): void => {
        if (writing) {
            const running = writingId.current;
            if (running !== null) {
                void transport.request('git.cancel', { actionId: running }).catch(() => undefined);
            }
            return;
        }
        const actionId = nextActionId();
        writingId.current = actionId;
        setWriting(true);
        transport
            .request('git.suggestMessage', { cwd, actionId })
            .then((suggestion) => {
                useGit.getState().setMessage(cwd, suggestion.body === '' ? suggestion.subject : `${suggestion.subject}\n\n${suggestion.body}`);
            })
            .catch((error: unknown) => {
                const text = error instanceof Error ? error.message : 'The message could not be written.';
                useToasts.getState().show({ title: 'No message was written', description: text.split('\n')[0], kind: 'error', output: text });
            })
            .finally(() => {
                writingId.current = null;
                setWriting(false);
            });
    };

    return (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border p-2">
            <textarea
                className={COMMIT_MESSAGE}
                rows={3}
                spellCheck={false}
                placeholder="Summary, then an empty line and the why."
                value={message}
                onChange={(event) => useGit.getState().setMessage(cwd, event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        commit(false);
                    }
                }}
            />
            <div className="flex flex-wrap items-center gap-2">
                {capabilities !== null && capabilities.messageProvider !== null && (
                    <Tooltip label={writing ? 'Stop writing the message' : `Let ${capabilities.messageProvider} write the message from the staged changes`}>
                        <Button size="sm" disabled={!changed} onClick={write}>
                            <Icon icon={writing ? LoaderCircle : Sparkles} size={12} className={writing ? 'animate-spin' : undefined} />
                            {writing ? 'Writing' : 'Write message'}
                        </Button>
                    </Tooltip>
                )}
                <span className="grow" />
                <Tooltip label={ready ? 'Commit and push in one go' : 'A message and a change are what a commit needs'}>
                    <Button size="sm" variant="secondary" disabled={!ready} onClick={() => commit(true)}>
                        Commit &amp; Push
                    </Button>
                </Tooltip>
                <Tooltip label={staged ? 'Commit what is staged' : 'Stage every change and commit it'}>
                    <Button size="sm" variant="primary" disabled={!ready} onClick={() => commit(false)}>
                        {staged ? 'Commit' : 'Stage all and commit'}
                    </Button>
                </Tooltip>
            </div>
        </div>
    );
}
