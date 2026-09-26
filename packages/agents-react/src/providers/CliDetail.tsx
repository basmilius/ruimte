import { useTranslation } from 'react-i18next';
import { ChevronRight, Plus } from 'lucide-react';
import type { AgentKind, ModelInfo, ProviderInfo } from '@ruimte/agent-contracts';
import { AccountDot } from '../agents/AccountDot';
import { ACCOUNT_TONE_CLASSES, accountName, accountStatusLine, type AccountEntry } from '../agents/accounts';
import { accountFor, forgetChatSelection, rememberChatAccount, rememberChatSelection, selectionFor, useChatPreferences } from '../chat/preferences';
import { Segmented, Toggle } from '@ruimte/ui/controls';
import { useChatScope } from '../scope';
import { providerAbilities } from './provider-abilities';
import { DetailHeader } from '@ruimte/ui/settings/DetailHeader';
import { CliTile } from './parts';
import { SettingsRow } from '@ruimte/ui/settings/SettingsRow';
import { SettingsSection } from '@ruimte/ui/settings/SettingsSection';
import { useProviderAccountsStore } from '../state/provider-accounts';
import { Button } from '@ruimte/ui/Button';
import { Icon } from '@ruimte/ui/Icon';
import { Select } from '@ruimte/ui/Select';

const PROVIDER_DEFAULT = '';

// Up to this many choices read at a glance side by side; more go into a menu.
const MAX_SEGMENTS = 3;

/* One row per knob the chosen model exposes; the composer's option picker shows the same descriptors. */
function ModelOptionRows({ provider, model, options }: { provider: AgentKind; model: ModelInfo; options: Record<string, string | boolean> }) {
    const setOption = (id: string, value: string | boolean): void => {
        rememberChatSelection(provider, { model: model.slug, options: { ...options, [id]: value } });
    };
    return (
        <>
            {model.options.map((option) => {
                if (option.type !== 'select') {
                    return (
                        <SettingsRow
                            key={option.id}
                            indent
                            muted
                            label={option.label}
                            control={
                                <Toggle checked={options[option.id] === true} label={option.label} onChange={(checked) => setOption(option.id, checked)} />
                            }
                        />
                    );
                }
                const value = String(options[option.id] ?? option.defaultChoice);
                return (
                    <SettingsRow
                        key={option.id}
                        indent
                        muted
                        label={option.label}
                        control={
                            option.choices.length <= MAX_SEGMENTS ? (
                                <Segmented
                                    value={value}
                                    label={option.label}
                                    options={option.choices.map((choice) => ({ id: choice.id, label: choice.label }))}
                                    onChange={(id) => setOption(option.id, id)}
                                />
                            ) : (
                                <Select
                                    value={value}
                                    label={option.label}
                                    align="end"
                                    items={option.choices.map((choice) => ({ value: choice.id, label: choice.label, description: choice.description }))}
                                    onValueChange={(id) => setOption(option.id, id)}
                                />
                            )
                        }
                    />
                );
            })}
        </>
    );
}

interface CliDetailProps {
    provider: ProviderInfo;
    /* Null for a machine that keeps no accounts. */
    entries: AccountEntry[] | null;
    canAddAccount: boolean;
    onAddAccount(): void;
    onPickAccount(id: string): void;
}

/* One CLI: what it is, what a new chat of it starts with, and its accounts. */
export function CliDetail({ provider, entries, canAddAccount, onAddAccount, onPickAccount }: CliDetailProps) {
    const { t } = useTranslation('agent-providers');
    const { id: scopeId } = useChatScope();
    const preferences = useChatPreferences();
    const selection = selectionFor(preferences, provider.kind);
    const model = provider.models.find((entry) => entry.slug === selection?.model);
    const machineAccounts = useProviderAccountsStore((s) => (s.byScope[scopeId]?.loaded ? s.byScope[scopeId].accounts : undefined));
    const picked = accountFor(preferences, scopeId, provider.kind, machineAccounts) ?? provider.kind;
    // An account that is off is out of every picker, unless it is the one picked already.
    const choosable = (entries ?? []).filter((entry) => entry.account.enabled !== false || entry.id === picked);
    const canLogIn = canAddAccount;

    return (
        <>
            <DetailHeader
                mark={<CliTile kind={provider.kind} />}
                title={provider.name}
                subtitle={`${provider.version ? `${t('abilities.version', { version: provider.version })} ` : ''}${providerAbilities(provider)}`}
                actions={
                    canAddAccount && (
                        <Button variant="secondary" className="whitespace-nowrap" onClick={onAddAccount}>
                            <Icon icon={Plus} size={14} />
                            {t('cli.addAccount')}
                        </Button>
                    )
                }
            />
            <SettingsSection title={t('cli.defaults.title')} description={t('cli.defaults.description')}>
                {choosable.length > 0 && (
                    <SettingsRow
                        searchId="providers.defaults.account"
                        label={t('cli.defaults.account')}
                        control={
                            <Select
                                value={picked}
                                label={t('cli.defaults.accountFor', { provider: provider.name })}
                                align="end"
                                items={choosable.map((entry) => ({
                                    value: entry.id,
                                    label: accountName(entry, provider.name),
                                    icon: <AccountDot color={entry.account.color} className="size-2" />
                                }))}
                                onValueChange={(id) => rememberChatAccount(scopeId, provider.kind, id)}
                            />
                        }
                    />
                )}
                {provider.models.length > 0 && (
                    <SettingsRow
                        searchId="providers.defaults.model"
                        label={t('cli.defaults.model')}
                        description={model ? t('cli.defaults.shared', { provider: provider.name }) : t('cli.defaults.usesCliDefault')}
                        control={
                            <Select
                                value={model?.slug ?? PROVIDER_DEFAULT}
                                label={t('cli.defaults.modelFor', { provider: provider.name })}
                                align="end"
                                items={[
                                    { value: PROVIDER_DEFAULT, label: t('cli.defaults.providerDefault') },
                                    ...provider.models.map((entry) => ({
                                        value: entry.slug,
                                        label: entry.legacy ? t('cli.defaults.legacyModel', { name: entry.name }) : entry.name
                                    }))
                                ]}
                                onValueChange={(value) =>
                                    value === PROVIDER_DEFAULT
                                        ? forgetChatSelection(provider.kind)
                                        : rememberChatSelection(provider.kind, { model: value, options: {} })
                                }
                            />
                        }
                    />
                )}
                {model && <ModelOptionRows provider={provider.kind} model={model} options={selection?.options ?? {}} />}
                {choosable.length === 0 && provider.models.length === 0 && <SettingsRow muted label={t('cli.defaults.usesCliDefault')} />}
            </SettingsSection>
            {entries === null ? (
                <p className="text-xs text-text-faint">{t('list.noAccounts')}</p>
            ) : (
                <SettingsSection title={t('cli.accounts')} footer={canAddAccount ? undefined : t('cli.onlyDefault', { provider: provider.name })}>
                    {entries.map((entry) => {
                        const status = accountStatusLine(entry.status, canLogIn);
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                className="flex w-full min-w-0 items-center gap-3 px-4.5 py-3 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-surface-hover"
                                onClick={() => onPickAccount(entry.id)}
                            >
                                <AccountDot color={entry.account.color} />
                                <span className="min-w-0 grow truncate text-sm text-text">{accountName(entry, provider.name)}</span>
                                <span className={`shrink-0 text-xs ${ACCOUNT_TONE_CLASSES[status.tone]}`}>{status.text}</span>
                                <Icon icon={ChevronRight} size={14} className="shrink-0 text-text-faint" />
                            </button>
                        );
                    })}
                </SettingsSection>
            )}
        </>
    );
}
