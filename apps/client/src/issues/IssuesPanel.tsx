import { Button, Icon, Input, messageOf, PanelEmpty, Pill, ScrollArea, SectionLabel, Spinner } from '@adecore/ui';
import type { HostIssuesPayload, HostIssueSummary, HostProviderStatus } from '@ruimte/contracts';
import { CircleCheck, CircleDot, MessageSquare, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { issueDialog } from '@/issues/dialogs';
import { shortRef } from '@/issues/look';
import { useHostProviders, useProjectLinks } from '@/issues/state';
import { readHosts } from '@/issues/watch';
import { useEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';
import { submitOnEnter } from '@/surface/submit-on-enter';
import { fireAndForget } from '@/transport-api/transport';
import { useTransport } from '@/workspace/context';

interface IssueFilter {
    assigned: boolean;
    open: boolean;
    query: string;
}

const DEFAULT_FILTER: IssueFilter = { assigned: true, open: true, query: '' };
const SHOWN_LABELS = 3;

function issuesPayload(projectId: string, provider: Pick<HostProviderStatus, 'provider' | 'remote'>, filter: IssueFilter, cursor?: string): HostIssuesPayload {
    return {
        projectId,
        provider: provider.provider,
        ...(provider.remote === undefined ? {} : { remote: provider.remote }),
        ...(filter.assigned ? { assigned: true } : {}),
        state: filter.open ? 'open' : 'all',
        ...(filter.query === '' ? {} : { query: filter.query }),
        ...(cursor === undefined ? {} : { cursor })
    };
}

interface IssuePages {
    issues: readonly HostIssueSummary[];
    /* There while the host has more. */
    cursor?: string;
    loading: boolean;
    failure: string | null;
}

const READING: IssuePages = { issues: [], loading: true, failure: null };

/* The issues of one host under a filter, a page at a time. `revision` moves when the machine says to read again. */
function useIssuePages(projectId: string, provider: HostProviderStatus, filter: IssueFilter, revision: number): IssuePages & { more(): void; again(): void } {
    const { t } = useTranslation('issues');
    const transport = useTransport();
    // `list` names what the pages were read for, so pages of another filter read as still being read and a late page is dropped.
    const [read, setRead] = useState<IssuePages & { list: string }>({ ...READING, list: '' });
    const [attempt, setAttempt] = useState(0);
    const { provider: id, remote } = provider;
    const { assigned, open, query } = filter;
    const list = JSON.stringify([projectId, id, remote, assigned, open, query, revision, attempt]);
    const pages = read.list === list ? read : READING;

    useEffect(() => {
        let current = true;

        transport
            .request('host.issues', issuesPayload(projectId, { provider: id, remote }, { assigned, open, query }))
            .then((page) => {
                if (current) {
                    setRead({ list, issues: page.issues, cursor: page.cursor, loading: false, failure: null });
                }
            })
            .catch((e: unknown) => {
                if (current) {
                    setRead({ list, issues: [], loading: false, failure: messageOf(e, t('panel.loadFailed')) });
                }
            });

        return () => {
            current = false;
        };
    }, [transport, projectId, id, remote, assigned, open, query, list, t]);

    function more(): void {
        if (pages.cursor === undefined || pages.loading) {
            return;
        }

        const patch = (next: (before: IssuePages) => IssuePages): void => setRead((before) => (before.list === list ? { ...next(before), list } : before));

        patch((before) => ({ ...before, loading: true }));
        transport
            .request('host.issues', issuesPayload(projectId, provider, filter, pages.cursor))
            .then((page) => patch((before) => ({ issues: [...before.issues, ...page.issues], cursor: page.cursor, loading: false, failure: null })))
            .catch((e: unknown) => patch((before) => ({ ...before, loading: false, failure: messageOf(e, t('panel.loadFailed')) })));
    }

    return { ...pages, more, again: () => setAttempt((before) => before + 1) };
}

function IssueRow({ issue, chats }: { issue: HostIssueSummary; chats: number }) {
    const { t } = useTranslation('issues');
    const closed = issue.state === 'closed';

    return (
        <button
            type="button"
            className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-hover"
            onClick={() => issueDialog.open({ ref: issue.ref, title: issue.title })}
        >
            <span role="img" aria-label={issue.stateLabel ?? t(`state.${issue.state}`)} className="mt-0.5 shrink-0">
                <Icon icon={closed ? CircleCheck : CircleDot} size={14} className={closed ? 'text-text-faint' : 'text-positive'} />
            </span>
            <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="text-sm break-words text-text">{issue.title}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-text-faint">
                    <span className="font-mono">{shortRef(issue.ref)}</span>
                    {issue.labels.slice(0, SHOWN_LABELS).map((label) => (
                        <Pill key={label} size="sm">
                            {label}
                        </Pill>
                    ))}
                </span>
            </span>
            {chats > 0 && (
                <span aria-label={t('panel.chats', { count: chats })} className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-text-muted tabular-nums">
                    <Icon icon={MessageSquare} size={12} /> {chats}
                </span>
            )}
        </button>
    );
}

function ProviderIssues({ projectId, provider, filter, revision }: { projectId: string; provider: HostProviderStatus; filter: IssueFilter; revision: number }) {
    const { t } = useTranslation('issues');
    const pages = useIssuePages(projectId, provider, filter, revision);
    const links = useProjectLinks();

    if (pages.failure !== null && pages.issues.length === 0) {
        return (
            <div className="flex flex-col items-start gap-2 px-3 py-2 text-xs text-text-muted">
                <span className="break-words">{pages.failure}</span>
                <Button size="sm" variant="secondary" onClick={pages.again}>
                    {t('panel.again')}
                </Button>
            </div>
        );
    }

    if (pages.loading && pages.issues.length === 0) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted">
                <Spinner size={12} /> {t('panel.reading')}
            </div>
        );
    }

    if (pages.issues.length === 0) {
        return <div className="px-3 py-2 text-xs text-text-muted">{t('panel.empty')}</div>;
    }

    return (
        <>
            {pages.issues.map((issue) => (
                <IssueRow key={issue.ref} issue={issue} chats={links.filter((link) => link.ref === issue.ref).length} />
            ))}
            {pages.failure !== null && <div className="px-3 py-1 text-xs break-words text-status-error">{pages.failure}</div>}
            {pages.cursor !== undefined && (
                <div className="px-3 py-2">
                    <Button size="sm" variant="secondary" disabled={pages.loading} onClick={pages.more}>
                        {t('panel.more')}
                    </Button>
                </div>
            )}
        </>
    );
}

/*
 * The issues of the project, from every host that lists them for it: the ones assigned to the person and still
 * open, until they say otherwise. A host that cannot answer says why in its place. A press on an issue opens it.
 */
export function IssuesPanel() {
    const { t } = useTranslation('issues');
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((state) => state.current?.projectId ?? null);
    const providers = useHostProviders().filter((provider) => provider.issues);
    const [filter, setFilter] = useState(DEFAULT_FILTER);
    const [typed, setTyped] = useState('');
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        if (projectId === null) {
            return;
        }

        // A person who signed in since the project opened sees their issues on opening the panel.
        void fireAndForget('host.status', readHosts(endpointId, projectId));
        void fireAndForget('host.watch', transport.request('host.watch', { projectId }));

        const off = transport.on('host.changed', (changed) => {
            if (changed.projectId === projectId && changed.ref === undefined) {
                void fireAndForget('host.status', readHosts(endpointId, projectId));
                setRevision((before) => before + 1);
            }
        });

        return () => {
            off();
            void fireAndForget('host.unwatch', transport.request('host.unwatch', { projectId }));
        };
    }, [transport, endpointId, projectId]);

    if (projectId === null || providers.length === 0) {
        return (
            <PanelEmpty icon={CircleDot} title={t('panel.noneTitle')}>
                {t('panel.none')}
            </PanelEmpty>
        );
    }

    function type(text: string): void {
        setTyped(text);

        // An emptied field shows everything again without a press on Enter.
        if (text.trim() === '' && filter.query !== '') {
            setFilter({ ...filter, query: '' });
        }
    }

    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
                <Input
                    size="sm"
                    icon={Search}
                    value={typed}
                    placeholder={t('panel.search')}
                    aria-label={t('panel.search')}
                    spellCheck={false}
                    onChange={(event) => type(event.target.value)}
                    onKeyDown={submitOnEnter(() => setFilter({ ...filter, query: typed.trim() }))}
                />
                <div className="flex items-center gap-1.5">
                    <Pill size="sm" pressed={filter.assigned} onClick={() => setFilter({ ...filter, assigned: !filter.assigned })}>
                        {t('panel.assigned')}
                    </Pill>
                    <Pill size="sm" pressed={filter.open} onClick={() => setFilter({ ...filter, open: !filter.open })}>
                        {t('panel.open')}
                    </Pill>
                </div>
            </div>
            <ScrollArea className="grow" viewportClassName="pb-2">
                {providers.map((provider) => (
                    <section key={`${provider.provider}:${provider.remote ?? ''}`} aria-label={provider.title}>
                        {(providers.length > 1 || provider.state !== 'ready') && (
                            <div className="flex items-baseline gap-2 px-3 pt-3 pb-1">
                                <SectionLabel>{provider.title}</SectionLabel>
                                {provider.repo !== undefined && <span className="min-w-0 truncate font-mono text-xs text-text-faint">{provider.repo}</span>}
                            </div>
                        )}
                        {provider.state === 'ready' ? (
                            <ProviderIssues projectId={projectId} provider={provider} filter={filter} revision={revision} />
                        ) : (
                            <div className="px-3 py-1 text-xs break-words text-text-muted">
                                {provider.reason ?? t(`panel.${provider.state === 'signed-out' ? 'signedOut' : 'unreachable'}`)}
                            </div>
                        )}
                    </section>
                ))}
            </ScrollArea>
        </div>
    );
}
