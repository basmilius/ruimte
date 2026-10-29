import { useTranslation } from 'react-i18next';
import type { ProjectAccounts } from '@ruimte/contracts';
import { AccountDot, AgentIcon, accountsOfKind, topAccountEntry, type AccountEntry } from '@adecore/agents-react/providers';
import { useProviderAccountsStore, useProvidersStore } from '@adecore/agents-react/state';
import { choiceAfter } from '@/shell/project-accounts';
import { useDocument } from '@/state/document';
import { transportFor } from '@/transport';
import { useMachineAnswers } from '@/transport/features';
import { SectionLabel, Select, Switch, useAsyncAction, FormError } from '@adecore/ui';

const MACHINE_DEFAULT = '';

/* The name a menu gives an account: its label, the CLI's name for an unnamed default one, else its id. */
function nameOf(entry: AccountEntry, providerName: string): string {
    return entry.account.label ?? (entry.isDefault ? providerName : entry.id);
}

/*
 * Per CLI with two accounts or more that are on, the account this project's new chats and agents start
 * on and the accounts it offers. One person's and this machine's, kept in the private project file.
 */
export function ProjectAccountsSection({ projectId, endpointId }: { projectId: string; endpointId: string }) {
    const { t } = useTranslation('shell');
    const answers = useMachineAnswers(endpointId, 'project.setAccounts');
    const machine = useProviderAccountsStore((s) => s.byScope[endpointId]?.accounts ?? null);
    const providers = useProvidersStore((s) => s.byScope[endpointId]?.providers);
    const rule: ProjectAccounts = useDocument((s) => s.accounts);
    const { busy, failure, run } = useAsyncAction(t('projectSettings.accountsFailed'));

    const kinds = [...new Set(Object.values(machine?.accounts ?? {}).map((account) => account.kind))].filter(
        (kind) => accountsOfKind(machine, kind).filter((entry) => entry.account.enabled !== false).length >= 2
    );

    if (!answers || kinds.length === 0) {
        return null;
    }

    const save = (kind: string, change: Parameters<typeof choiceAfter>[1]): void => {
        void run(async () => {
            const choice = choiceAfter(rule[kind], change);
            // The project file changes, and its change brings the new choice to this window as to every other.
            await (transportFor(endpointId)?.request('project.setAccounts', { projectId, kind, ...choice }) ??
                Promise.reject(new Error(t('projectSettings.accountsFailed'))));
        });
    };

    return (
        <>
            <SectionLabel render={<div />} className="mt-5 mb-0.5">
                {t('projectSettings.accounts')}
            </SectionLabel>
            <p className="mb-1.5 text-sm text-text-faint">{t('projectSettings.accountsNote')}</p>
            {kinds.map((kind) => {
                const providerName = providers?.find((provider) => provider.kind === kind)?.name ?? kind;
                const entries = accountsOfKind(machine, kind).filter((entry) => entry.account.enabled !== false);
                const top = topAccountEntry(entries);
                const off = rule[kind]?.off ?? [];
                const offered = entries.filter((entry) => !off.includes(entry.id));
                const preferred = offered.some((entry) => entry.id === rule[kind]?.default) ? (rule[kind]?.default ?? MACHINE_DEFAULT) : MACHINE_DEFAULT;

                return (
                    <div key={kind} className="mt-2 flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-sm text-text">
                            <AgentIcon kind={kind} />
                            <span className="grow">{providerName}</span>
                            <Select
                                value={preferred}
                                label={t('projectSettings.defaultAccount', { provider: providerName })}
                                align="end"
                                disabled={busy}
                                items={[
                                    {
                                        value: MACHINE_DEFAULT,
                                        label: t('projectSettings.machineDefault', { account: top === null ? providerName : nameOf(top, providerName) })
                                    },
                                    ...offered.map((entry) => ({
                                        value: entry.id,
                                        label: nameOf(entry, providerName),
                                        icon: <AccountDot color={entry.account.color} className="size-2" />
                                    }))
                                ]}
                                onValueChange={(value) => save(kind, { default: value === MACHINE_DEFAULT ? null : value })}
                            />
                        </div>
                        {entries.map((entry) => {
                            const isOffered = !off.includes(entry.id);
                            const locked = entry.id === preferred || (isOffered && offered.length === 1);

                            return (
                                <div key={entry.id} className="flex items-center gap-2 pl-6 text-sm text-text">
                                    <AccountDot color={entry.account.color} />
                                    <span className="grow truncate">{nameOf(entry, providerName)}</span>
                                    <Switch
                                        checked={isOffered}
                                        disabled={busy || locked}
                                        label={t('projectSettings.offerAccount', { account: nameOf(entry, providerName) })}
                                        onCheckedChange={(checked) => save(kind, { account: entry.id, offered: checked })}
                                    />
                                </div>
                            );
                        })}
                    </div>
                );
            })}
            {failure && <FormError className="mt-2 break-words">{failure}</FormError>}
        </>
    );
}
