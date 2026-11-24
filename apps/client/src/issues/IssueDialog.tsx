import { rememberChatSelection } from '@adecore/agents-react/chat';
import { Markdown } from '@adecore/agents-react/chat/ui';
import { Button, Checkbox, CloseButton, Dialog, ErrorBoundary, FormError, Icon, messageOf, Pill, ScrollArea, SectionLabel, Spinner } from '@adecore/ui';
import type { AgentKind, HostChangeSummary, HostIssue, HostIssuePromptResult, HostLink, HostRef } from '@ruimte/contracts';
import { ExternalLink, GitPullRequest, MessageSquare } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { issueDialog } from '@/issues/dialogs';
import { CHECK_COLORS, CHECK_ICONS, shortRef } from '@/issues/look';
import { startIssueChat } from '@/issues/start-chat';
import { useIssueLinks } from '@/issues/state';
import { showChat, useChatName } from '@/output/kinds';
import { useEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';
import { fireAndForget } from '@/transport-api/transport';
import { useTransport } from '@/workspace/context';
import { createStartWorktree, useWorktreeStart } from '@/worktrees/use-worktree-start';
import { WorktreeStartFields } from '@/worktrees/WorktreeStartFields';

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="border-t border-border px-5 py-3">
            <SectionLabel>{title}</SectionLabel>
            <div className="mt-2">{children}</div>
        </section>
    );
}

function ChangeRow({ change }: { change: HostChangeSummary }) {
    const { t } = useTranslation('issues');
    const state = change.draft === true ? t('state.draft') : (change.stateLabel ?? t(`state.${change.state}`));

    const row = (
        <>
            <Icon icon={GitPullRequest} size={14} className="mt-0.5 shrink-0 text-text-muted" />
            <span className="min-w-0 grow break-words text-text">{change.title}</span>
            <span className="shrink-0 text-xs text-text-muted">{state}</span>
            {change.checkState !== undefined && (
                <span role="img" aria-label={t(`checks.${change.checkState}`)} className="mt-0.5 shrink-0">
                    <Icon icon={CHECK_ICONS[change.checkState]} size={14} className={CHECK_COLORS[change.checkState]} />
                </span>
            )}
        </>
    );

    if (change.url === undefined) {
        return <div className="flex items-start gap-2 py-1 text-sm">{row}</div>;
    }

    return (
        <a className="flex items-start gap-2 rounded-md py-1 text-sm hover:bg-surface-hover" href={change.url} target="_blank" rel="noreferrer">
            {row}
        </a>
    );
}

/* A chat that left the project since it was linked has no name here and no row. */
function ChatRow({ link }: { link: HostLink }) {
    const name = useChatName(link.chatId);

    if (name === null) {
        return null;
    }

    function open(): void {
        issueDialog.close();
        showChat(link.chatId);
    }

    return (
        <button type="button" className="flex w-full items-center gap-2 rounded-md py-1 text-left text-sm hover:bg-surface-hover" onClick={open}>
            <Icon icon={MessageSquare} size={14} className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate text-text">{name}</span>
        </button>
    );
}

/*
 * Starts a chat on the issue: in the project folder on the CLI a new chat opens with, or in a worktree on a
 * branch named after the issue, with the fields the new worktree chat has.
 */
function StartChat({ projectId, issueRef }: { projectId: string; issueRef: HostRef }) {
    const { t } = useTranslation('issues');
    const transport = useTransport();
    const endpointId = useEndpointId();
    const folder = useProject((state) => state.current?.folder ?? null);
    const [inWorktree, setInWorktree] = useState(false);
    const [opening, setOpening] = useState<HostIssuePromptResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const start = useWorktreeStart(inWorktree ? folder : null, opening?.branch ?? null);
    const ready = !busy && (!inWorktree || (start !== null && opening !== null && start.ready));

    async function readOpening(): Promise<HostIssuePromptResult> {
        const read = opening ?? (await transport.request('host.issuePrompt', { projectId, ref: issueRef }));
        setOpening(read);

        return read;
    }

    function pickWorktree(next: boolean): void {
        setInWorktree(next);
        setFailure(null);

        if (next) {
            // The fields propose the branch the machine names after the issue.
            readOpening().catch((e: unknown) => setFailure(messageOf(e, t('start.failed'))));
        }
    }

    async function submit(): Promise<void> {
        if (!ready) {
            return;
        }

        setBusy(true);
        setFailure(null);

        try {
            const read = await readOpening();
            let place: { cwd: string; provider: AgentKind } | undefined;

            if (inWorktree && start !== null && start.provider !== null) {
                const worktree = await createStartWorktree(start);

                if (start.selection !== null) {
                    rememberChatSelection(start.provider, start.selection);
                }

                place = { cwd: worktree.path, provider: start.provider };
            }

            await startIssueChat({ transport, endpointId, projectId, ref: issueRef, opening: read, ...(place === undefined ? {} : { place }) });
            issueDialog.close();
        } catch (e) {
            setFailure(messageOf(e, t('start.failed')));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="border-t border-border px-5 py-3">
            {inWorktree && start !== null && opening !== null && <WorktreeStartFields start={start} idPrefix="issue-worktree" onSubmit={() => void submit()} />}
            {failure !== null && <FormError className="mt-2 break-words">{failure}</FormError>}
            <div className="flex items-center gap-3">
                {folder !== null && (
                    <label className="flex items-center gap-2 text-sm text-text">
                        <Checkbox checked={inWorktree} label={t('start.worktree')} disabled={busy} onCheckedChange={pickWorktree} />
                        {t('start.worktree')}
                    </label>
                )}
                <span className="grow" />
                <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
                    {busy ? t('start.starting') : t('start.chat')}
                </Button>
            </div>
        </div>
    );
}

function IssueBody({ issue, links }: { issue: HostIssue; links: readonly HostLink[] }) {
    const { t } = useTranslation('issues');

    return (
        <>
            <div className="px-5 py-3">
                {/* A stranger wrote this, so it goes through the renderer chat text goes through and never in as HTML. */}
                {issue.body.trim() === '' ? <p className="text-sm text-text-muted">{t('issue.noText')}</p> : <Markdown text={issue.body} fileLinks={false} />}
            </div>
            {issue.labels.length > 0 && (
                <Section title={t('issue.labels')}>
                    <div className="flex flex-wrap gap-1.5">
                        {issue.labels.map((label) => (
                            <Pill key={label}>{label}</Pill>
                        ))}
                    </div>
                </Section>
            )}
            {issue.assignees.length > 0 && (
                <Section title={t('issue.assignees')}>
                    <p className="text-sm break-words text-text">{issue.assignees.join(', ')}</p>
                </Section>
            )}
            {issue.changes.length > 0 && (
                <Section title={t('issue.changes')}>
                    {issue.changes.map((change) => (
                        <ChangeRow key={change.ref} change={change} />
                    ))}
                </Section>
            )}
            {links.length > 0 && (
                <Section title={t('issue.chats')}>
                    {links.map((link) => (
                        <ChatRow key={link.chatId} link={link} />
                    ))}
                </Section>
            )}
            {issue.comments.length > 0 && (
                <Section title={t('issue.comments')}>
                    {issue.comments.map((comment) => (
                        <article key={comment.id} className="py-1.5">
                            <p className="text-xs font-medium text-text-muted">{comment.author}</p>
                            <Markdown text={comment.body} fileLinks={false} />
                        </article>
                    ))}
                </Section>
            )}
        </>
    );
}

function IssueSheet({ projectId, issueRef, title }: { projectId: string; issueRef: HostRef; title: string }) {
    const { t } = useTranslation('issues');
    const transport = useTransport();
    const links = useIssueLinks(issueRef);
    const [issue, setIssue] = useState<HostIssue | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    useEffect(() => {
        let current = true;

        const read = (): void => {
            transport
                .request('host.issue', { projectId, ref: issueRef })
                .then((answer) => {
                    if (current) {
                        setIssue(answer.issue);
                        setFailure(null);
                    }
                })
                .catch((e: unknown) => {
                    if (current) {
                        setFailure(messageOf(e, t('issue.loadFailed')));
                    }
                });
        };

        read();
        void fireAndForget('host.watch', transport.request('host.watch', { projectId, ref: issueRef }));

        const off = transport.on('host.changed', (changed) => {
            if (changed.projectId === projectId && changed.ref === issueRef) {
                read();
            }
        });

        return () => {
            current = false;
            off();
            void fireAndForget('host.unwatch', transport.request('host.unwatch', { projectId, ref: issueRef }));
        };
    }, [transport, projectId, issueRef, t]);

    const shown = issue ?? { title, state: undefined, stateLabel: undefined, author: undefined, url: undefined };

    return (
        <>
            <div className="flex items-start gap-4 border-b border-border px-5 py-4">
                <div className="flex min-w-0 grow flex-col gap-1.5">
                    <Dialog.Title className="break-words">{shown.title}</Dialog.Title>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        {shown.state !== undefined && (
                            <Pill className={shown.state === 'open' ? 'text-positive' : undefined}>{shown.stateLabel ?? t(`state.${shown.state}`)}</Pill>
                        )}
                        <span className="font-mono">{shortRef(issueRef)}</span>
                        {shown.author !== undefined && <span>{t('issue.by', { author: shown.author })}</span>}
                    </div>
                </div>
                {shown.url !== undefined && (
                    <Button variant="ghost" size="sm" href={shown.url}>
                        {t('issue.openInBrowser')} <Icon icon={ExternalLink} size={12} />
                    </Button>
                )}
                <CloseButton label={t('issue.close')} dialog />
            </div>
            <ScrollArea className="grow">
                {failure !== null && <p className="px-5 py-3 text-sm break-words text-status-error">{failure}</p>}
                {issue === null && failure === null && (
                    <p className="flex items-center gap-2 px-5 py-3 text-sm text-text-muted">
                        <Spinner size={12} /> {t('issue.reading')}
                    </p>
                )}
                {issue !== null && <IssueBody issue={issue} links={links} />}
            </ScrollArea>
            <StartChat projectId={projectId} issueRef={issueRef} />
            <Dialog.Description className="sr-only">{t('issue.description')}</Dialog.Description>
        </>
    );
}

/* One issue as its host has it now, with the chats that work on it, and the place a person starts one more from. */
export function IssueDialog() {
    const { t } = useTranslation('issues');
    const request = issueDialog.useRequest((asked) => asked);
    const projectId = useProject((state) => state.current?.projectId ?? null);

    return (
        <Dialog.Root open={request !== null} onOpenChange={(next) => !next && issueDialog.close()}>
            <Dialog.Popup className="flex h-[640px] w-[560px] flex-col">
                <ErrorBoundary label={t('issue.failed')} resetKeys={[request?.ref]}>
                    {request !== null && projectId !== null && (
                        <IssueSheet key={request.ref} projectId={projectId} issueRef={request.ref} title={request.title} />
                    )}
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
