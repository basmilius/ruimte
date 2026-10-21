import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NanoGptConfigurePayload, NanoGptSettings, NanoGptStatus } from '@ruimte/contracts';
import { Button, Input, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useProvidersStore } from '@adecore/agents-react/state';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { transportFor } from '@/transport';

/* A whole number a person types, kept as text until they leave the field, and sent once if it is one inside the range. */
function CountField({
    value,
    min,
    max,
    label,
    disabled,
    onCommit
}: {
    value: number;
    min: number;
    max: number;
    label: string;
    disabled: boolean;
    onCommit(next: number): void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = (): void => {
        const next = Number(draft);
        setDraft(null);
        if (draft !== null && Number.isInteger(next) && next >= min && next <= max && next !== value) {
            onCommit(next);
        }
    };
    return (
        <Input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={draft ?? String(value)}
            aria-label={label}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    commit();
                }
            }}
        />
    );
}

/*
 * The NanoGPT subscription of a machine. The key goes to the machine once and never comes back: the
 * field stays empty and the status only says whether one is saved. Mounted per machine (`key`), so
 * another machine starts from an empty field.
 */
export function NanoGptSection({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('settings');
    const [apiKey, setApiKey] = useState('');
    const [status, setStatus] = useState<NanoGptStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        let active = true;
        link.request('nanogpt.status', {}).then(
            (value) => {
                if (active) {
                    setStatus(value);
                }
            },
            () => {
                if (active) {
                    setError(t('providers.nanogpt.unavailable'));
                }
            }
        );
        return () => {
            active = false;
        };
    }, [endpointId, t]);

    const configure = async (payload: NanoGptConfigurePayload): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            setStatus(await link.request('nanogpt.configure', payload));
            setApiKey('');
            const { providers } = await link.request('provider.list', {});
            useProvidersStore.getState().setProviders(endpointId, providers);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('providers.nanogpt.failed'));
        } finally {
            setBusy(false);
        }
    };

    // Settings alone fetch nothing and change no model, so only the answer is kept.
    const change = async (settings: Partial<NanoGptSettings>): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        setError('');
        try {
            setStatus(await link.request('nanogpt.configure', { settings }));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('providers.nanogpt.failed'));
        }
    };

    const settings = status?.settings;
    const state = busy
        ? t('providers.nanogpt.loading')
        : status === null
          ? t('providers.nanogpt.unknown')
          : status.configured
            ? t('providers.nanogpt.ready', { count: status.models })
            : t('providers.nanogpt.disconnected');

    return (
        <SettingsSection title="NanoGPT Subscription" description={t('providers.nanogpt.description')} scope="machine" footer={t('providers.nanogpt.footer')}>
            <SettingsRow
                label={t('providers.nanogpt.key')}
                description={t('providers.nanogpt.keyDescription')}
                control={
                    <Input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        aria-label={t('providers.nanogpt.key')}
                        placeholder={status?.configured ? t('providers.nanogpt.saved') : ''}
                        disabled={busy}
                    />
                }
            />
            <SettingsRow
                label={t('providers.nanogpt.status')}
                description={state}
                control={
                    <div className="flex gap-2">
                        <Button disabled={busy || apiKey.trim() === ''} onClick={() => void configure({ apiKey: apiKey.trim() })}>
                            {t('providers.nanogpt.save')}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({})}>
                            {t('providers.nanogpt.refresh')}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({ apiKey: '' })}>
                            {t('providers.nanogpt.disconnect')}
                        </Button>
                    </div>
                }
            />
            {settings !== undefined && (
                <>
                    <SettingsRow
                        label={t('providers.nanogpt.continue.label')}
                        description={t('providers.nanogpt.continue.description')}
                        control={
                            <Switch
                                checked={settings.autoContinue}
                                onCheckedChange={(autoContinue) => void change({ autoContinue })}
                                label={t('providers.nanogpt.continue.label')}
                            />
                        }
                    />
                    <SettingsRow
                        label={t('providers.nanogpt.rounds.label')}
                        description={t('providers.nanogpt.rounds.description')}
                        control={
                            <CountField
                                value={settings.roundsPerRun}
                                min={5}
                                max={200}
                                label={t('providers.nanogpt.rounds.label')}
                                disabled={false}
                                onCommit={(roundsPerRun) => void change({ roundsPerRun })}
                            />
                        }
                    />
                    <SettingsRow
                        label={t('providers.nanogpt.runs.label')}
                        description={t('providers.nanogpt.runs.description')}
                        control={
                            <CountField
                                value={settings.runs}
                                min={1}
                                max={20}
                                label={t('providers.nanogpt.runs.label')}
                                disabled={!settings.autoContinue}
                                onCommit={(runs) => void change({ runs })}
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
