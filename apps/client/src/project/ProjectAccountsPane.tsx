import { AccountDot, AgentIcon, accountsOfKind, topAccountEntry, type AccountEntry } from '@adecore/agents-react/providers';
import { useProviderAccountsStore, useProvidersStore } from '@adecore/agents-react/state';
import { FormError, Select, Switch, useAsyncAction } from '@adecore/ui';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import type { ProjectAccounts } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { choiceAfter } from '@/project/project-accounts';
import { useProjectSettingsSubject } from '@/project/project-settings-subject';
import { useDocument } from '@/state/document';
import { useMachineAnswers } from '@/transport/features';
import { transportFor } from '@/transport/index';

const MACHINE_DEFAULT = '';

function nameOf(entry: AccountEntry, providerName: string): string {
    return entry.account.label ?? (entry.isDefault ? providerName : entry.id);
}

/*
 * Per CLI with two accounts or more that are on, the account this project's new chats and agents start
 * on and the accounts it offers. One person's and this machine's, kept in the private project file.
 */
export function ProjectAccountsPane() {
    const { t } = useTranslation('shell');
    const { project, endpointId } = useProjectSettingsSubject();
    const projectId = project.projectId;
    const answers = useMachineAnswers(endpointId, 'project.setAccounts');
    const machine = useProviderAccountsStore((s) => s.byScope[endpointId]?.accounts ?? null);
    const providers = useProvidersStore((s) => s.byScope[endpointId]?.providers);
    const rule: ProjectAccounts = useDocument((s) => s.accounts);
    const { busy, failure, run } = useAsyncAction(t('projectSettings.accountsFailed'));

    const kinds = [...new Set(Object.values(machine?.accounts ?? {}).map((account) => account.kind))].filter(
        // Every account counts, also one turned off on the machine, so a choice made before stays where it can be undone.
        (kind) => accountsOfKind(machine, kind).length >= 2
    );

    if (!answers || kinds.length === 0) {
        return (
            <SettingsSection>
                <SettingsRow muted label={t('projectSettings.accountsNone')} />
            </SettingsSection>
        );
    }

    const save = (kind: string, change: Parameters<typeof choiceAfter>[1]): void => {
        void run(async () => {
            const choice = choiceAfter(rule[kind], change);

            // The project file changes, and its change brings the new choice to this window as to every other.
            await (transportFor(endpointId)?.request('project.setAccounts', { projectId, kind, ...choice, seen: rule[kind] ?? {} }) ??
                Promise.reject(new Error(t('projectSettings.accountsFailed'))));
        });
    };

    return (
        <>
            {kinds.map((kind) => {
                const providerName = providers?.find((provider) => provider.kind === kind)?.name ?? kind;
                const entries = accountsOfKind(machine, kind);
                const top = topAccountEntry(entries);
                const off = rule[kind]?.off ?? [];
                const offered = entries.filter((entry) => entry.account.enabled !== false && !off.includes(entry.id));
                const preferred = offered.some((entry) => entry.id === rule[kind]?.default) ? (rule[kind]?.default ?? MACHINE_DEFAULT) : MACHINE_DEFAULT;

                return (
                    <SettingsSection key={kind} title={providerName}>
                        <SettingsRow
                            searchId={`accounts.${kind}`}
                            leading={<AgentIcon kind={kind} />}
                            label={t('projectSettings.defaultAccount', { provider: providerName })}
                            control={
                                <Select
                                    size="sm"
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
                            }
                        />
                        {entries.map((entry) => {
                            const isOffered = !off.includes(entry.id);
                            const locked = entry.id === preferred || (offered.length === 1 && offered[0]?.id === entry.id);

                            return (
                                <SettingsRow
                                    key={entry.id}
                                    indent
                                    muted={entry.account.enabled === false}
                                    leading={<AccountDot color={entry.account.color} />}
                                    label={nameOf(entry, providerName)}
                                    control={
                                        <Switch
                                            checked={isOffered}
                                            disabled={busy || locked}
                                            label={t('projectSettings.offerAccount', { account: nameOf(entry, providerName) })}
                                            onCheckedChange={(checked) => save(kind, { account: entry.id, offered: checked })}
                                        />
                                    }
                                />
                            );
                        })}
                    </SettingsSection>
                );
            })}
            {failure && <FormError className="break-words">{failure}</FormError>}
        </>
    );
}
