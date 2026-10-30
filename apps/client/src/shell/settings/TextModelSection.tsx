import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TEXT_MODEL_PROVIDERS, type TextModelChoice } from '@ruimte/contracts';
import { ChatScopeContext } from '@adecore/agents-react';
import { useProviderAccounts, useProviders } from '@adecore/agents-react/state';
import { Button, ErrorBoundary, FormError, Select, type SelectItem } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { chatScopeOf } from '@/transport/chat-scope';
import { useEndpointConnection } from '@/transport/status';
import { useMachineSetting } from './machine-setting';
import { usePickedMachine } from './picked-machine';
import { SettingsSection } from './SettingsSection';

export function TextModelSection() {
    const { t } = useTranslation('settings');
    const endpoint = usePickedMachine();

    if (endpoint === null) {
        return null;
    }

    return (
        <SettingsSection title={t('agents.textModel.title')} scope="machine" machine="picked">
            <ErrorBoundary key={endpoint.id} label={t('agents.textModel.failed')}>
                <ChatScopeContext.Provider value={chatScopeOf(endpoint.id)}>
                    <TextModelRows endpoint={endpoint} />
                </ChatScopeContext.Provider>
            </ErrorBoundary>
        </SettingsSection>
    );
}

function TextModelRows({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const info = useServers((state) => state.byEndpoint[endpoint.id]);
    const providers = useProviders((state) => state.providers);
    const loaded = useProviders((state) => state.loaded);
    const accounts = useProviderAccounts((state) => state.accounts);
    const accountsLoaded = useProviderAccounts((state) => state.loaded);
    const connection = useEndpointConnection(endpoint.id);
    const { busy, save } = useMachineSetting(endpoint);
    const choice = info?.textModel ?? null;
    const [catalog, setCatalog] = useState<{ key: string; models: { slug: string; name: string }[]; failed: boolean } | null>(null);
    const [retry, setRetry] = useState(0);
    const catalogKey = JSON.stringify([endpoint.id, choice?.provider, choice?.account, retry]);
    const printMode = choice?.provider === 'antigravity';
    const canList = machineAnswers(connection, 'provider.textModels') && transportFor(endpoint.id) !== null;
    const printCatalog = catalog?.key === catalogKey ? catalog : !canList ? { key: catalogKey, models: [], failed: true } : null;

    useEffect(() => {
        if (choice?.provider !== 'antigravity' || connection.status !== 'open') {
            return;
        }

        let cancelled = false;
        const key = catalogKey;
        const link = transportFor(endpoint.id);
        if (link === null || !canList) {
            return;
        }

        void link.request('provider.textModels', { provider: choice.provider, account: choice.account }).then(
            ({ models }) => {
                if (!cancelled) {
                    setCatalog({ key, models, failed: false });
                }
            },
            () => {
                if (!cancelled) {
                    setCatalog({ key, models: [], failed: true });
                }
            }
        );

        return () => {
            cancelled = true;
        };
    }, [endpoint.id, choice?.provider, choice?.account, connection, catalogKey, canList]);

    const supported = info?.textModel !== undefined;
    const connected = connection.status === 'open';
    const owner = choice === null ? undefined : providers.find((provider) => provider.kind === choice.provider);
    const offered = providers.filter((provider) => provider.installed && TEXT_MODEL_PROVIDERS.some((kind) => kind === provider.kind));
    const disabled = busy || !connected || !supported || !loaded;
    const providerItems: SelectItem<string>[] = [
        { value: 'automatic', label: t('agents.textModel.automatic') },
        ...offered.map((provider) => ({ value: provider.kind, label: provider.name }))
    ];

    if (choice !== null && !offered.some((provider) => provider.kind === choice.provider)) {
        providerItems.push({ value: choice.provider, label: owner?.name ?? choice.provider, disabled: true });
    }

    const availableModels = printMode ? (printCatalog?.models ?? []) : (owner?.models ?? []);
    const modelItems: SelectItem<string>[] = [
        { value: '', label: t(choice?.provider === 'apple' ? 'agents.textModel.systemDefault' : 'agents.textModel.cliDefault') },
        ...availableModels.filter((model) => model.slug !== 'default').map((model) => ({ value: model.slug, label: model.name }))
    ];

    if (choice?.model && !modelItems.some((model) => model.value === choice.model)) {
        modelItems.push({ value: choice.model, label: choice.model, disabled: true });
    }

    const accountItems: SelectItem<string>[] = [
        { value: '', label: t('agents.textModel.defaultAccount') },
        ...Object.entries(accounts?.accounts ?? {})
            .filter(([, account]) => account.kind === choice?.provider && account.enabled !== false)
            .sort(([, left], [, right]) => (left.order ?? Infinity) - (right.order ?? Infinity))
            .map(([id, account]) => ({ value: id, label: account.label ?? id }))
    ];

    if (choice?.account && !accountItems.some((account) => account.value === choice.account)) {
        accountItems.push({ value: choice.account, label: choice.account, disabled: true });
    }

    const change = (next: TextModelChoice | null): void => {
        void save({ textModel: next });
    };
    const accountUnavailable =
        choice?.account !== undefined &&
        accountsLoaded &&
        !Object.entries(accounts?.accounts ?? {}).some(
            ([id, account]) => id === choice.account && account.kind === choice.provider && account.enabled !== false
        );
    const unavailable =
        choice !== null &&
        (accountUnavailable ||
            !owner?.installed ||
            (choice.model !== null && (!printMode || printCatalog !== null) && !availableModels.some((model) => model.slug === choice.model)));
    const description = !connected
        ? t('machine.notAnswering')
        : info === undefined || !loaded
          ? t('agents.textModel.loading')
          : !supported
            ? t('agents.textModel.update')
            : unavailable
              ? t('agents.textModel.unavailable')
              : t('agents.textModel.description');

    return (
        <>
            <SettingsRow
                searchId="agents.textModel"
                label={t('agents.textModel.label')}
                description={description}
                control={
                    <Select
                        value={choice?.provider ?? 'automatic'}
                        label={t('agents.textModel.label')}
                        items={providerItems}
                        disabled={disabled}
                        align="end"
                        onValueChange={(value) => {
                            const provider = TEXT_MODEL_PROVIDERS.find((kind) => kind === value);
                            change(provider === undefined ? null : { provider, model: null });
                        }}
                    />
                }
            />
            {choice !== null && (
                <>
                    <SettingsRow
                        indent
                        label={t('agents.textModel.model')}
                        description={t(choice.provider === 'apple' ? 'agents.textModel.local' : 'agents.textModel.reasoning')}
                        control={
                            <Select
                                value={choice.model ?? ''}
                                label={t('agents.textModel.model')}
                                items={modelItems}
                                searchable={20}
                                disabled={disabled || !owner?.installed || (printMode && connected && printCatalog === null)}
                                align="end"
                                onValueChange={(value) => change({ ...choice, model: value === '' ? null : value })}
                            />
                        }
                    >
                        {printMode && printCatalog?.failed && (
                            <div className="flex flex-col items-start gap-2">
                                <FormError>{t('agents.textModel.catalogFailed')}</FormError>
                                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setRetry((value) => value + 1)}>
                                    {t('agents.textModel.retry')}
                                </Button>
                            </div>
                        )}
                    </SettingsRow>
                    {choice.provider !== 'apple' && (
                        <SettingsRow
                            indent
                            label={t('agents.textModel.account')}
                            control={
                                <Select
                                    value={choice.account ?? ''}
                                    label={t('agents.textModel.account')}
                                    items={accountItems}
                                    disabled={disabled || !accountsLoaded}
                                    align="end"
                                    onValueChange={(value) =>
                                        change({ provider: choice.provider, model: choice.model, ...(value === '' ? {} : { account: value }) })
                                    }
                                />
                            }
                        />
                    )}
                </>
            )}
        </>
    );
}
