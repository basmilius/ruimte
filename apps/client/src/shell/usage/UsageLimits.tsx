import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn } from 'lucide-react';
import type { UsageProvider } from '@ruimte/contracts';
import { AccountDot } from '@/agents/AccountDot';
import { Segmented } from '@/shell/settings/controls';
import { openLogin } from '@/shell/settings/providers/account-actions';
import { PROVIDER_COLORS, PROVIDER_LABELS } from '@/shell/usage/format';
import { accountNote, checkedLabel, hasSeveralAccounts, isSignedOut, type LimitAccount } from '@/shell/usage/limit-groups';
import { WindowBar } from '@/shell/usage/LimitsList';
import { useLimitGroups, useMinute, useUsageLimits } from '@/shell/usage/limits';
import { useProviderAccountsStore } from '@/state/provider-accounts';
import { useUsageEndpointId } from '@/state/usage';
import { useWindow } from '@/state/window';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { ProviderLogo } from '@/ui/ProviderLogo';
import { Tooltip } from '@/ui/Tooltip';

type Filter = UsageProvider | 'all';

interface Login {
    /* Why a login cannot open a terminal right now, or null when it can. */
    blocked: string | null;
    open: (account: LimitAccount) => void;
}

function LoginButton({ account, login }: { account: LimitAccount; login: Login }) {
    const { t } = useTranslation('usage');
    const button = (
        <Button
            variant="secondary"
            size="sm"
            className={login.blocked === null ? 'self-start' : undefined}
            disabled={login.blocked !== null}
            onClick={() => login.open(account)}
        >
            <Icon icon={LogIn} size={14} />
            {t('limits.logIn')}
        </Button>
    );
    return login.blocked === null ? (
        button
    ) : (
        <Tooltip label={login.blocked}>
            <span className="inline-flex self-start">{button}</span>
        </Tooltip>
    );
}

/* One account: where its numbers come from, then a bar per window, or why there are none. */
function LimitCard({ account, named, now, login }: { account: LimitAccount; named: boolean; now: number; login: Login | null }) {
    const { t } = useTranslation('usage');
    const signedOut = isSignedOut(account);
    const note = signedOut ? null : accountNote(account);
    const plan = signedOut ? null : account.entry?.plan;
    const checked = signedOut || account.entry === null ? null : checkedLabel(account.entry, now);
    return (
        <div className="flex min-w-0 flex-col gap-3.5 rounded-xl border border-border bg-surface bg-clip-padding px-4 py-3.5">
            <p className="flex min-w-0 items-center gap-2 text-xs font-medium">
                <span className="shrink-0" style={{ color: PROVIDER_COLORS[account.kind] }}>
                    <ProviderLogo provider={account.kind} />
                </span>
                <span className="shrink-0">{PROVIDER_LABELS[account.kind]}</span>
                {named && (
                    <>
                        <span className="text-text-faint">·</span>
                        <AccountDot color={account.color} />
                        <span className="truncate">{account.name}</span>
                    </>
                )}
                {plan && <span className="shrink-0 font-normal text-text-muted">· {plan}</span>}
                {checked !== null && <span className="ml-auto shrink-0 pl-2 font-normal text-text-faint">{checked}</span>}
            </p>
            {signedOut ? (
                <>
                    <p className="text-xs text-text-faint">{t('limits.signedOutDetail')}</p>
                    {login !== null && <LoginButton account={account} login={login} />}
                </>
            ) : note !== null ? (
                <p className="text-xs text-text-faint">{note}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {account.entry?.windows.map((window) => (
                        <WindowBar key={window.id} window={window} now={now} compact={false} />
                    ))}
                </div>
            )}
        </div>
    );
}

/*
 * What is left of each plan, asked of the CLIs themselves, a card per account. Nothing here reads a
 * credential: every CLI holds its own login and answers the question when the daemon starts one and asks.
 */
export function UsageLimits() {
    const { t } = useTranslation('usage');
    const limits = useUsageLimits();
    const groups = useLimitGroups(limits);
    const now = useMinute();
    const endpointId = useUsageEndpointId();
    const loginCommands = useProviderAccountsStore((s) => s.byEndpoint[endpointId]?.accounts?.loginCommands);
    // A login runs in a terminal node on a canvas of a project on the machine these numbers are of.
    const workspaceMachine = useWindow((s) => (s.content.kind === 'workspace' ? s.content.workspace.connection.endpointId : null));
    const [filter, setFilter] = useState<Filter>('all');

    if (limits === null) {
        return null;
    }
    const filterable = groups.length > 1 && hasSeveralAccounts(groups);
    const current = filterable && groups.some((group) => group.kind === filter) ? filter : 'all';
    const shown = current === 'all' ? groups : groups.filter((group) => group.kind === current);
    const blocked = workspaceMachine === endpointId ? null : t('settings:providers.account.login.needsProject');
    const loginFor = (kind: UsageProvider): Login | null =>
        loginCommands?.[kind] === undefined ? null : { blocked, open: (account) => void openLogin(endpointId, kind, account.id, account.name) };

    return (
        <section className="flex flex-col gap-3">
            <div className="flex min-h-8 items-center gap-3">
                <h2 className={`${SECTION_LABEL} grow`}>{t('limits.title')}</h2>
                {filterable && (
                    <Segmented<Filter>
                        value={current}
                        options={[
                            { id: 'all', label: t('dialog.accounts.all') },
                            ...groups.map((group) => ({ id: group.kind, label: PROVIDER_LABELS[group.kind] }))
                        ]}
                        onChange={setFilter}
                        label={t('limits.filter')}
                    />
                )}
            </div>
            <p className="text-xs text-text-muted">{t('limits.explain')}</p>
            <div className="grid grid-cols-2 gap-3">
                {shown.flatMap((group) =>
                    group.accounts.map((account) => (
                        <LimitCard key={account.id} account={account} named={group.accounts.length > 1} now={now} login={loginFor(group.kind)} />
                    ))
                )}
            </div>
        </section>
    );
}
