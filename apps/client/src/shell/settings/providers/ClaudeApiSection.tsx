import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeApiConfigurePayload, ClaudeApiSettings, ClaudeApiStatus } from '@ruimte/contracts';
import { Button, Input, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useProvidersStore } from '@adecore/agents-react/state';
import { CountField } from '@/shell/settings/providers/CountField';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { transportFor } from '@/transport';

/*
 * The Claude API of a machine, with an API key the person made themselves. The key goes to the machine once and never comes back: the
 * field stays empty and the status only says whether one is saved. Mounted per machine (`key`), so
 * another machine starts from an empty field.
 */
export function ClaudeApiSection({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('settings');
    const [apiKey, setApiKey] = useState('');
    const [status, setStatus] = useState<ClaudeApiStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        let active = true;
        link.request('anthropic.status', {}).then(
            (value) => {
                if (active) {
                    setStatus(value);
                }
            },
            () => {
                if (active) {
                    setError(t('providers.claudeApi.unavailable'));
                }
            }
        );
        return () => {
            active = false;
        };
    }, [endpointId, t]);

    const configure = async (payload: ClaudeApiConfigurePayload): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            setStatus(await link.request('anthropic.configure', payload));
            setApiKey('');
            const { providers } = await link.request('provider.list', {});
            useProvidersStore.getState().setProviders(endpointId, providers);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('providers.claudeApi.failed'));
        } finally {
            setBusy(false);
        }
    };

    // Settings alone fetch nothing and change no model, so only the answer is kept.
    const change = async (settings: Partial<ClaudeApiSettings>): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        setError('');
        try {
            setStatus(await link.request('anthropic.configure', { settings }));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('providers.claudeApi.failed'));
        }
    };

    const settings = status?.settings;
    const state = busy
        ? t('providers.claudeApi.loading')
        : status === null
          ? t('providers.claudeApi.unknown')
          : status.configured
            ? t('providers.claudeApi.ready', { count: status.models })
            : t('providers.claudeApi.disconnected');

    return (
        <SettingsSection title="Claude API" description={t('providers.claudeApi.description')} scope="machine" footer={t('providers.claudeApi.footer')}>
            <SettingsRow
                label={t('providers.claudeApi.key')}
                description={t('providers.claudeApi.keyDescription')}
                control={
                    <Input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        aria-label={t('providers.claudeApi.key')}
                        placeholder={status?.configured ? t('providers.claudeApi.saved') : ''}
                        disabled={busy}
                    />
                }
            />
            <SettingsRow
                label={t('providers.anthropic.status')}
                description={state}
                control={
                    <div className="flex gap-2">
                        <Button disabled={busy || apiKey.trim() === ''} onClick={() => void configure({ apiKey: apiKey.trim() })}>
                            {t('providers.claudeApi.save')}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({})}>
                            {t('providers.claudeApi.refresh')}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({ apiKey: '' })}>
                            {t('providers.claudeApi.disconnect')}
                        </Button>
                    </div>
                }
            />
            {settings !== undefined && (
                <>
                    <SettingsRow
                        label={t('providers.claudeApi.continue.label')}
                        description={t('providers.claudeApi.continue.description')}
                        control={
                            <Switch
                                checked={settings.autoContinue}
                                onCheckedChange={(autoContinue) => void change({ autoContinue })}
                                label={t('providers.claudeApi.continue.label')}
                            />
                        }
                    />
                    <SettingsRow
                        label={t('providers.claudeApi.rounds.label')}
                        description={t('providers.claudeApi.rounds.description')}
                        control={
                            <CountField
                                value={settings.roundsPerRun}
                                min={5}
                                max={200}
                                label={t('providers.claudeApi.rounds.label')}
                                disabled={false}
                                onCommit={(roundsPerRun) => void change({ roundsPerRun })}
                            />
                        }
                    />
                    <SettingsRow
                        label={t('providers.claudeApi.runs.label')}
                        description={t('providers.claudeApi.runs.description')}
                        control={
                            <CountField
                                value={settings.runs}
                                min={1}
                                max={20}
                                label={t('providers.claudeApi.runs.label')}
                                disabled={!settings.autoContinue}
                                onCommit={(runs) => void change({ runs })}
                            />
                        }
                    />
                    <SettingsRow
                        label={t('providers.claudeApi.tokens.label')}
                        description={t('providers.claudeApi.tokens.description')}
                        control={
                            <CountField
                                value={settings.maxOutputTokens}
                                min={1024}
                                max={128000}
                                label={t('providers.claudeApi.tokens.label')}
                                disabled={false}
                                onCommit={(maxOutputTokens) => void change({ maxOutputTokens })}
                            />
                        }
                    />
                </>
            )}
            {error !== '' && (
                <p role="alert" className="px-3 pb-3 break-words text-status-error">
                    {error}
                </p>
            )}
        </SettingsSection>
    );
}
