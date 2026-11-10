import { rememberChatSelection, offerDraft } from '@adecore/agents-react/chat';
import { useChats } from '@adecore/agents-react/state';
import { Button, Dialog, ErrorBoundary, Field, FormError, Icon, Input, Pill, ScrollArea, TextArea, messageOf } from '@adecore/ui';
import type { GitIssue } from '@ruimte/contracts';
import { CircleDot } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { issueStartDialog } from '@/github/dialogs';
import { findIssueNode, issueBranch, issuePrompt } from '@/github/issue-start';
import { focusChat } from '@/plan/plan-actions';
import { useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { nodesOfView, useViewNodes } from '@/state/view-nodes';
import { submitOnEnter } from '@/surface/submit-on-enter';
import { useTransport } from '@/workspace/context';
import { createStartWorktree, useWorktreeStart } from '@/worktrees/use-worktree-start';
import { createWorktreeChat } from '@/worktrees/worktree-chat';
import { WorktreeStartFields } from '@/worktrees/WorktreeStartFields';

// How long a new chat node gets to register its chat with the machine before the prompt is left as a draft.
const CHAT_OPEN_TIMEOUT_MS = 10_000;

/*
 * Starts a chat on a GitHub issue: the issue is read through `gh`, a worktree is made for it, and the chat
 * opens in that worktree with the issue as its first prompt. A second start of the same issue in the same
 * worktree shows the chat it already has.
 */
export function IssueStartDialog() {
    const { t } = useTranslation('shell');
    const open = issueStartDialog.useOpen();
    const close = (): void => issueStartDialog.set(false);
    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
            <Dialog.Popup size="sm" className="flex flex-col">
                <Dialog.Title className="flex items-center gap-2">
                    <Icon icon={CircleDot} size={16} /> {t('issueStart.title')}
                </Dialog.Title>
                <ErrorBoundary label={t('issueStart.failed')} resetKeys={[open]}>
                    {open && <IssueStartForm onDone={close} />}
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* Resolves once the machine has the chat, so a prompt sent right after creating the node has somewhere to go. */
function whenChatOpens(endpointId: string, chatId: string): Promise<boolean> {
    const key = endpointKey(endpointId, chatId);
    return new Promise((resolve) => {
        if (useChats.getState().byKey[key]?.info !== undefined) {
            resolve(true);
            return;
        }
        const timer = setTimeout(() => {
            stop();
            resolve(false);
        }, CHAT_OPEN_TIMEOUT_MS);
        const stop = useChats.subscribe((state) => {
            if (state.byKey[key]?.info !== undefined) {
                clearTimeout(timer);
                stop();
                resolve(true);
            }
        });
    });
}

function IssueStartForm({ onDone }: { onDone(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const folder = useProject((s) => s.current?.folder ?? null);
    const [text, setText] = useState('');
    const [issue, setIssue] = useState<GitIssue | null>(null);
    const [reading, setReading] = useState(false);
    const [readFailure, setReadFailure] = useState<string | null>(null);
    const [typedPrompt, setTypedPrompt] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const start = useWorktreeStart(folder, issue === null ? null : issueBranch(issue));
    const startedNode = useViewNodes((views, nodesOf) => (issue === null ? null : findIssueNode(views, nodesOf, issue.url)));
    const prompt = typedPrompt ?? (issue === null ? '' : issuePrompt(issue));
    const ready = start !== null && start.ready && issue !== null && prompt.trim() !== '' && !busy;

    async function read(): Promise<void> {
        if (folder === null || text.trim() === '' || reading) {
            return;
        }
        setReading(true);
        setReadFailure(null);
        setIssue(null);
        setTypedPrompt(null);
        try {
            const read = await transport.request('git.issue', { cwd: folder, ref: text.trim() });
            if (isPullRequestUrl(read.url)) {
                setReadFailure(t('issueStart.isPullRequest'));
            } else {
                setIssue(read);
            }
        } catch (e) {
            setReadFailure(issueFailure(e, t));
        } finally {
            setReading(false);
        }
    }

    async function submit(): Promise<void> {
        if (start === null || issue === null || !ready || start.provider === null) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const worktree = await createStartWorktree(start);
            const existing = findIssueNode(useDocument.getState().views, nodesOfView, issue.url, worktree.path);
            if (existing !== null) {
                focusChat(existing);
                onDone();
                return;
            }
            if (start.selection !== null) {
                rememberChatSelection(start.provider, start.selection);
            }
            const marker = { repo: issue.repo, number: issue.number, url: issue.url };
            const chatId = await createWorktreeChat({
                cwd: worktree.path,
                provider: start.provider,
                title: `#${issue.number} ${issue.title}`.slice(0, 60),
                issue: marker
            });
            if (chatId === null) {
                throw new Error(t('newWorktreeChat.noCanvas'));
            }
            if (await whenChatOpens(endpointId, chatId)) {
                await perform('chat.send', { chatId, prompt: prompt.trim() });
            } else {
                offerDraft(chatId, prompt);
            }
            onDone();
        } catch (e) {
            setFailure(messageOf(e, t('issueStart.failed')));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <ScrollArea className="-mx-1" viewportClassName="px-1">
                <Dialog.Text className="mt-1">{t('issueStart.description')}</Dialog.Text>
                <Field label={t('issueStart.refLabel')} error={readFailure} className="mt-3">
                    <div className="flex items-center gap-2">
                        <Input
                            mono
                            autoFocus
                            className="grow"
                            value={text}
                            placeholder={t('issueStart.refPlaceholder')}
                            spellCheck={false}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={submitOnEnter(() => void read())}
                        />
                        <Button variant="secondary" disabled={reading || text.trim() === '' || folder === null} onClick={() => void read()}>
                            {reading ? t('issueStart.reading') : t('issueStart.read')}
                        </Button>
                    </div>
                </Field>
                {issue !== null && (
                    <div className="mt-3 rounded-lg border border-border bg-surface bg-clip-padding p-3.5">
                        <div className="flex items-center gap-2">
                            <Pill mono icon={<Icon icon={CircleDot} size={12} />}>
                                {issue.repo}#{issue.number}
                            </Pill>
                            <Pill size="sm" tone={issue.state === 'OPEN' ? 'idle' : 'muted'}>
                                {t(issue.state === 'OPEN' ? 'issueStart.state.open' : 'issueStart.state.closed')}
                            </Pill>
                        </div>
                        <p className="mt-2 text-sm text-text">{issue.title}</p>
                        {issue.labels.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {issue.labels.map((label) => (
                                    <Pill key={label} size="sm">
                                        {label}
                                    </Pill>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {startedNode !== null && (
                    <div className="mt-2 flex items-center justify-between gap-2">
                        <Dialog.Text size="xs">{t('issueStart.alreadyStarted')}</Dialog.Text>
                        <Button
                            size="xs"
                            onClick={() => {
                                focusChat(startedNode);
                                onDone();
                            }}
                        >
                            {t('issueStart.open')}
                        </Button>
                    </div>
                )}
                {issue !== null && start !== null && (
                    <>
                        <WorktreeStartFields start={start} idPrefix="issue-start" onSubmit={() => void submit()} />
                        <Field label={t('issueStart.prompt')} className="mt-3">
                            <TextArea mono className="h-28" value={prompt} spellCheck={false} onChange={(e) => setTypedPrompt(e.target.value)} />
                        </Field>
                    </>
                )}
                {failure && <FormError className="mt-2">{failure}</FormError>}
            </ScrollArea>
            <Dialog.Footer>
                <Button onClick={onDone}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
                    {busy ? t('issueStart.starting') : t('issueStart.start')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

/* `gh` resolves a pull request reference as an issue; the start needs an issue. */
function isPullRequestUrl(url: string): boolean {
    return /\/pull\/\d+/.test(url);
}

/* The reason a read failed in the person's words: the machine's code when it has one, else its message. */
function issueFailure(error: unknown, t: (key: string) => string): string {
    const code = (error as { code?: unknown } | null)?.code;
    switch (code) {
        case 'gh-missing':
            return t('issueStart.noGh');
        case 'gh-unauthenticated':
            return t('issueStart.unauthenticated');
        case 'issue-not-found':
            return t('issueStart.notFound');
        default:
            return messageOf(error, t('issueStart.failed'));
    }
}
