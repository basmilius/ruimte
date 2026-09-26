import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Plus, Terminal } from 'lucide-react';
import type { AgentKind, ProviderInfo } from '@ruimte/agent-contracts';
import { AccountDot } from '../agents/AccountDot';
import { ACCOUNT_TONE_CLASSES, accountName, accountsOfKind, accountStatusLine, type AccountEntry } from '../agents/accounts';
import { Skeleton } from '@ruimte/ui/controls';
import { MasterDetail } from '@ruimte/ui/settings/MasterDetail';
import { chatHost } from '../host';
import { useChatScope } from '../scope';
import { AccountDetail } from './AccountDetail';
import { AddAccountForm } from './AddAccountForm';
import { CliDetail } from './CliDetail';
import { CliMark } from './parts';
import { useProviderAccounts } from '../state/provider-accounts';
import { useProviders } from '../state/providers';
import { SECTION_LABEL } from '@ruimte/ui/classes';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

type Picked = { kind: 'cli'; cli: AgentKind } | { kind: 'account'; id: string } | { kind: 'add'; cli: AgentKind };

/* A row of the list with a control of its own beside the part that picks it, so the two never nest. */
function ListRow({
    selected,
    onSelect,
    children,
    trailing,
    className
}: {
    selected: boolean;
    onSelect(): void;
    children: ReactNode;
    trailing?: ReactNode;
    className?: string;
}) {
    return (
        <div className={clsx('flex min-w-0 shrink-0 items-center gap-2 rounded-lg pr-2', selected ? 'bg-text/5' : 'hover:bg-surface-hover', className)}>
            <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                className="flex min-w-0 grow items-center gap-3 self-stretch rounded-lg py-2 pl-3 text-left focus-visible:-outline-offset-2"
                onClick={onSelect}
            >
                {children}
            </button>
            {trailing}
        </div>
    );
}

interface ProvidersPaneProps {
    /* The row a search result leads to, by its `searchId`; the pane opens on the CLI it belongs to. */
    target?: string | null;
    /* The detail of a provider the app draws itself, such as a model the host runs on its own; null draws the CLI's own. */
    detailOf?(provider: ProviderInfo): ReactNode | null;
}

/* The agent CLIs of the host in scope, each with its accounts, beside the detail of what is picked. */
export function ProvidersPane({ target = null, detailOf }: ProvidersPaneProps) {
    const { t } = useTranslation('agent-providers');
    const { id: scopeId } = useChatScope();
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const accounts = useProviderAccounts((s) => s.accounts);
    const { openLogin } = chatHost();
    const loginBlocked = chatHost().useLoginBlocked(scopeId);
    const [picked, setPicked] = useState<Picked | null>(() => (target === 'providers.apple' ? { kind: 'cli', cli: 'apple' } : null));

    const installed = useMemo(() => providers.filter((provider) => provider.installed || provider.kind === 'apple'), [providers]);
    const missing = useMemo(() => providers.filter((provider) => !provider.installed && provider.kind !== 'apple'), [providers]);
    const entriesOf = (kind: AgentKind): AccountEntry[] => accountsOfKind(accounts, kind);
    const canAddAccount = (kind: AgentKind): boolean => accounts?.loginCommands?.[kind] !== undefined;

    // What was picked may be gone since (an account removed elsewhere); the first CLI stands in for it.
    const pickedEntry = picked?.kind === 'account' ? (Object.hasOwn(accounts?.accounts ?? {}, picked.id) ? picked.id : null) : null;
    const current: Picked | null =
        picked !== null && (picked.kind !== 'account' || pickedEntry !== null) ? picked : installed[0] ? { kind: 'cli', cli: installed[0].kind } : null;
    const currentAccount = current?.kind === 'account' ? accounts?.accounts[current.id] : undefined;
    const currentCli = current === null ? null : current.kind === 'account' ? (currentAccount?.kind as AgentKind | undefined) : current.cli;
    const provider = installed.find((entry) => entry.kind === currentCli) ?? null;

    // A search result lands on a row of a CLI's detail, so a picked account makes way for its CLI.
    const [seenTarget, setSeenTarget] = useState(target);
    if (target !== seenTarget) {
        setSeenTarget(target);
        if (target === 'providers.apple') {
            setPicked({ kind: 'cli', cli: 'apple' });
        } else if (target?.startsWith('providers.') && current?.kind !== 'cli' && provider !== null) {
            setPicked({ kind: 'cli', cli: provider.kind });
        }
    }

    const added = (id: string, name: string, made: boolean): void => {
        setPicked({ kind: 'account', id });
        if (made && provider !== null && openLogin !== null && loginBlocked === null) {
            void openLogin(scopeId, provider.kind, id, name);
        }
    };

    const group = (cli: ProviderInfo) => {
        const entries = cli.installed ? entriesOf(cli.kind) : [];
        return (
            <div key={cli.kind} className="flex min-w-0 shrink-0 flex-col gap-0.5 pt-1">
                <ListRow
                    selected={current?.kind === 'cli' && current.cli === cli.kind}
                    onSelect={() => setPicked({ kind: 'cli', cli: cli.kind })}
                    className="pr-1"
                    trailing={
                        canAddAccount(cli.kind) && (
                            <Tooltip label={t('list.addAccount', { provider: cli.name })} name>
                                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setPicked({ kind: 'add', cli: cli.kind })}>
                                    <Icon icon={Plus} size={14} />
                                </button>
                            </Tooltip>
                        )
                    }
                >
                    <CliMark kind={cli.kind} />
                    <span className="min-w-0 grow truncate text-xs font-medium text-text">{cli.name}</span>
                    {cli.kind !== 'apple' && cli.version && <span className="shrink-0 font-mono text-code text-text-faint">{cli.version}</span>}
                </ListRow>
                {entries.map((entry) => {
                    const name = accountName(entry, cli.name);
                    const status = accountStatusLine(entry.status, canAddAccount(cli.kind));
                    return (
                        <ListRow
                            key={entry.id}
                            selected={current?.kind === 'account' && current.id === entry.id}
                            onSelect={() => setPicked({ kind: 'account', id: entry.id })}
                        >
                            <span className="grid w-3.5 shrink-0 place-items-center">
                                <AccountDot color={entry.account.color} className="size-2.25" />
                            </span>
                            <span className="flex min-w-0 grow flex-col">
                                <span className="flex min-w-0 items-center gap-2 text-sm text-text">
                                    <span className="truncate">{name}</span>
                                    {entry.isDefault && (
                                        <span className="shrink-0 rounded-md bg-surface-active px-1.5 text-xs text-text-muted">{t('list.default')}</span>
                                    )}
                                </span>
                                <span className={clsx('truncate text-xs', ACCOUNT_TONE_CLASSES[status.tone])}>{status.text}</span>
                            </span>
                        </ListRow>
                    );
                })}
            </div>
        );
    };

    const list = !loaded ? (
        <div className="flex flex-col gap-3 p-3">
            <Skeleton className="w-32" />
            <Skeleton className="w-40" />
        </div>
    ) : (
        <>
            {installed.map(group)}
            {installed.length === 0 && <p className="px-3 py-2 text-xs text-text-muted">{t('list.none')}</p>}
            {missing.length > 0 && (
                <div className="mt-1.5 flex min-w-0 shrink-0 flex-col border-t border-border pt-2.5 pb-2">
                    <span className={clsx(SECTION_LABEL, 'px-3 pt-1 pb-1.5')}>{t('list.notInstalled')}</span>
                    {missing.map((cli) => (
                        <div key={cli.kind} className="flex h-10 min-w-0 items-center gap-3 px-3 text-sm text-text-muted">
                            <Icon icon={Terminal} size={14} className="shrink-0" />
                            <span className="min-w-0 grow truncate">{cli.name}</span>
                            <span className="shrink-0 text-xs text-text-faint">{t('list.missing')}</span>
                        </div>
                    ))}
                    <p className="mt-1 px-3 text-xs text-text-faint">{t('list.notInstalledNote')}</p>
                </div>
            )}
        </>
    );

    const detail = (): ReactNode => {
        if (current === null || provider === null) {
            return null;
        }
        const own = current.kind === 'cli' ? (detailOf?.(provider) ?? null) : null;
        if (own !== null) {
            return own;
        }
        if (current.kind === 'add') {
            return (
                <AddAccountForm
                    key={provider.kind}
                    provider={provider}
                    entries={entriesOf(provider.kind)}
                    onCancel={() => setPicked({ kind: 'cli', cli: provider.kind })}
                    onAdded={added}
                />
            );
        }
        if (current.kind === 'account') {
            const entry = entriesOf(provider.kind).find((candidate) => candidate.id === current.id);
            return (
                entry && (
                    <AccountDetail
                        key={entry.id}
                        provider={provider}
                        entry={entry}
                        canLogIn={openLogin !== null && canAddAccount(provider.kind)}
                        loginBlocked={loginBlocked}
                        secretsAvailable={accounts?.secretsAvailable === true}
                        onRemoved={() => setPicked({ kind: 'cli', cli: provider.kind })}
                    />
                )
            );
        }
        return (
            <CliDetail
                provider={provider}
                entries={accounts === null ? null : entriesOf(provider.kind)}
                canAddAccount={canAddAccount(provider.kind)}
                onAddAccount={() => setPicked({ kind: 'add', cli: provider.kind })}
                onPickAccount={(id) => setPicked({ kind: 'account', id })}
            />
        );
    };

    return (
        <MasterDetail
            listWidth={340}
            listLabel={t('list.label')}
            list={list}
            detail={
                <ErrorBoundary label={t('failed')} resetKeys={[scopeId, current?.kind, currentCli]}>
                    <div className="flex min-w-0 flex-col gap-7">{detail()}</div>
                </ErrorBoundary>
            }
        />
    );
}
