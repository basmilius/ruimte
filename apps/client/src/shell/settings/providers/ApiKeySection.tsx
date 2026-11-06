import { useProvidersStore } from '@adecore/agents-react/state';
import { Button, Input, Segmented, Switch, messageOf } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { ClaudeApiSettings, ClaudeApiStatus, NanoGptSettings, NanoGptStatus } from '@ruimte/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from '@/machines/SettingsSection';
import { CountField } from '@/shell/settings/providers/CountField';
import { listProvidersAgain } from '@/shell/settings/providers/use-provider-installs';
import { useUi } from '@/state/ui';
import { transportFor, type Transport } from '@/transport';

type ClaudeApiWindow = NonNullable<ClaudeApiSettings['contextWindow']>;

const CONTEXT_WINDOWS: readonly ClaudeApiWindow[] = ['200k', '1m'];

interface RunSettings {
    readonly autoContinue: boolean;
    readonly roundsPerRun: number;
    readonly runs: number;
}

interface KeyStatus<Settings> {
    readonly configured: boolean;
    readonly models: number;
    readonly settings?: Settings;
}

/* An empty key disconnects, no key fetches the models again, and settings alone fetch nothing. */
interface KeyPayload<Settings> {
    readonly apiKey?: string;
    readonly settings?: Partial<RunSettings> | Partial<Settings>;
}

interface ApiKeySectionProps<Settings extends RunSettings> {
    readonly endpointId: string;
    readonly title: string;
    readonly words: 'providers.nanogpt' | 'providers.claudeApi';
    status(link: Transport): Promise<KeyStatus<Settings>>;
    configure(link: Transport, payload: KeyPayload<Settings>): Promise<KeyStatus<Settings>>;
    extraRows?(settings: Settings, change: (next: Partial<Settings>) => void): ReactNode;
    // False for a provider whose CLI cuts its own runs, so the rounds a plain API counts mean nothing there.
    readonly runRows?: boolean;
    // Rows of the provider's own under the key, such as what else it needs on the machine.
    readonly children?: ReactNode;
}

/*
 * A provider behind an API key a person made themselves. The key goes to the machine once and never comes
 * back: the field stays empty and the status only says whether one is saved. Mounted per machine (`key`), so
 * another machine starts from an empty field.
 */
function ApiKeySection<Settings extends RunSettings>({
    endpointId,
    title,
    words,
    status: read,
    configure: write,
    extraRows,
    runRows = true,
    children
}: ApiKeySectionProps<Settings>) {
    const { t } = useTranslation('settings');
    const [apiKey, setApiKey] = useState('');
    const [status, setStatus] = useState<KeyStatus<Settings> | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const link = transportFor(endpointId);

        if (!link) {
            return;
        }

        let active = true;

        read(link).then(
            (value) => {
                if (active) {
                    setStatus(value);
                }
            },
            () => {
                if (active) {
                    setError(t(`${words}.unavailable`));
                }
            }
        );

        return () => {
            active = false;
        };
    }, [endpointId, read, words, t]);

    const configure = async (payload: KeyPayload<Settings>): Promise<void> => {
        const link = transportFor(endpointId);

        if (!link) {
            return;
        }

        setBusy(true);
        setError('');

        try {
            setStatus(await write(link, payload));
            setApiKey('');
            await listProvidersAgain(endpointId);
        } catch (cause) {
            setError(messageOf(cause, t(`${words}.failed`)));
        } finally {
            setBusy(false);
        }
    };

    // Settings alone change no model, so the provider list stays as it is.
    const change = async (settings: KeyPayload<Settings>['settings']): Promise<void> => {
        const link = transportFor(endpointId);

        if (!link) {
            return;
        }

        setError('');

        try {
            setStatus(await write(link, { settings }));
        } catch (cause) {
            setError(messageOf(cause, t(`${words}.failed`)));
        }
    };

    const settings = status?.settings;
    const state = busy
        ? t(`${words}.loading`)
        : status === null
          ? t(`${words}.unknown`)
          : status.configured
            ? t(`${words}.ready`, { count: status.models })
            : t(`${words}.disconnected`);

    return (
        <SettingsSection title={title} description={t(`${words}.description`)} scope="machine" footer={t(`${words}.footer`)}>
            <SettingsRow
                label={t(`${words}.key`)}
                description={t(`${words}.keyDescription`)}
                control={
                    <Input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        aria-label={t(`${words}.key`)}
                        placeholder={status?.configured ? t(`${words}.saved`) : ''}
                        disabled={busy}
                    />
                }
            />
            <SettingsRow
                label={t(`${words}.status`)}
                description={state}
                control={
                    <div className="flex gap-2">
                        <Button disabled={busy || apiKey.trim() === ''} onClick={() => void configure({ apiKey: apiKey.trim() })}>
                            {t(`${words}.save`)}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({})}>
                            {t(`${words}.refresh`)}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({ apiKey: '' })}>
                            {t(`${words}.disconnect`)}
                        </Button>
                    </div>
                }
            />
            {children}
            {settings !== undefined && (
                <>
                    {runRows && <RunRows settings={settings} words={words} change={(next) => void change(next)} />}
                    {extraRows?.(settings, (next) => void change(next))}
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

/* How far a chat on a plain API goes alone; a chat in a CLI is cut by the CLI itself. */
function RunRows({
    settings,
    words,
    change
}: {
    settings: RunSettings;
    words: ApiKeySectionProps<RunSettings>['words'];
    change(next: Partial<RunSettings>): void;
}) {
    const { t } = useTranslation('settings');

    return (
        <>
            <SettingsRow
                label={t(`${words}.continue.label`)}
                description={t(`${words}.continue.description`)}
                control={
                    <Switch checked={settings.autoContinue} onCheckedChange={(autoContinue) => change({ autoContinue })} label={t(`${words}.continue.label`)} />
                }
            />
            <SettingsRow
                label={t(`${words}.rounds.label`)}
                description={t(`${words}.rounds.description`)}
                control={
                    <CountField
                        value={settings.roundsPerRun}
                        min={5}
                        max={200}
                        label={t(`${words}.rounds.label`)}
                        disabled={false}
                        onCommit={(roundsPerRun) => change({ roundsPerRun })}
                    />
                }
            />
            <SettingsRow
                label={t(`${words}.runs.label`)}
                description={t(`${words}.runs.description`)}
                control={
                    <CountField
                        value={settings.runs}
                        min={1}
                        max={20}
                        label={t(`${words}.runs.label`)}
                        disabled={!settings.autoContinue}
                        onCommit={(runs) => change({ runs })}
                    />
                }
            />
        </>
    );
}

function nanoGptStatus(link: Transport): Promise<NanoGptStatus> {
    return link.request('nanogpt.status', {});
}

function configureNanoGpt(link: Transport, payload: KeyPayload<NanoGptSettings>): Promise<NanoGptStatus> {
    return link.request('nanogpt.configure', payload);
}

function claudeApiStatus(link: Transport): Promise<ClaudeApiStatus> {
    return link.request('anthropic.status', {});
}

function configureClaudeApi(link: Transport, payload: KeyPayload<ClaudeApiSettings>): Promise<ClaudeApiStatus> {
    return link.request('anthropic.configure', payload);
}

export function NanoGptSection({ endpointId }: { endpointId: string }) {
    return <ApiKeySection endpointId={endpointId} title="NanoGPT" words="providers.nanogpt" status={nanoGptStatus} configure={configureNanoGpt} />;
}

export function ClaudeApiSection({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('settings');
    const row = useProvidersStore((s) => s.byScope[endpointId]);
    const claude = row?.loaded ? row.providers.find((provider) => provider.kind === 'claude') : undefined;

    return (
        <ApiKeySection
            endpointId={endpointId}
            title="Claude API"
            words="providers.claudeApi"
            status={claudeApiStatus}
            configure={configureClaudeApi}
            runRows={false}
            extraRows={(settings, change) => (
                <>
                    <SettingsRow
                        label={t('providers.claudeApi.window.label')}
                        description={t('providers.claudeApi.window.description')}
                        control={
                            <Segmented<ClaudeApiWindow>
                                value={settings.contextWindow ?? '200k'}
                                options={CONTEXT_WINDOWS.map((id) => ({ id, label: t(`providers.claudeApi.window.options.${id}`) }))}
                                label={t('providers.claudeApi.window.label')}
                                onValueChange={(contextWindow) => change({ contextWindow })}
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
                                onCommit={(maxOutputTokens) => change({ maxOutputTokens })}
                            />
                        }
                    />
                </>
            )}
        >
            {claude !== undefined && !claude.installed && (
                <SettingsRow
                    label={claude.name}
                    description={t('providers.claudeApi.cli.missing')}
                    control={
                        <Button onClick={() => useUi.getState().setSettings({ open: true, section: 'providers', target: 'providers.install.claude' })}>
                            {t('providers.claudeApi.cli.install')}
                        </Button>
                    }
                />
            )}
        </ApiKeySection>
    );
}
