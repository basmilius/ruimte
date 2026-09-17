import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { desktop, type OpenAiCredentialStatus } from '@/desktop/bridge';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Badge, Skeleton } from '@/shell/settings/controls';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';
import { useVoice } from '@/voice/state';
import { closeVoicePanel } from '@/voice/controller';
import { DEFAULT_MICROPHONE_ID, listMicrophones, type MicrophoneDevice } from '@/voice/microphone';
import { LIVE_VOICES, VOICE_LANGUAGES } from '@/voice/preferences';

const failureText = (error: unknown): string => (error instanceof Error ? error.message : 'The API key could not be saved.');

const titleCase = (value: string): string => value[0]!.toUpperCase() + value.slice(1);

const descriptionFor = (status: OpenAiCredentialStatus): string => {
    if (status.configured && status.persistent) {
        return "Encrypted with this computer's keychain. Ruimte never shows the saved value again.";
    }
    if (status.configured) {
        return 'Encryption is unavailable, so this key is kept only until Ruimte quits.';
    }
    return 'Required for GPT-Live. The key stays in the desktop shell and is never stored in a project.';
};

export function VoicePane() {
    const [status, setStatus] = useState<OpenAiCredentialStatus | null>(null);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
    const [microphonesAvailable, setMicrophonesAvailable] = useState(() => navigator.mediaDevices !== undefined);
    const bridge = desktop()?.openAi;
    const sharedStatus = useVoice((state) => state.credential);
    const displayStatus = sharedStatus ?? status;
    const language = useSettings((state) => state.voiceLanguage);
    const voice = useSettings((state) => state.liveVoice);
    const microphoneId = useSettings((state) => state.voiceInputDeviceId);
    const updateSettings = useSettings((state) => state.update);

    useEffect(() => {
        let current = true;
        bridge
            ?.credentialStatus()
            .then((next) => {
                if (current) {
                    setStatus(next);
                    useVoice.getState().setCredential(next);
                }
            })
            .catch((error: unknown) => {
                if (current) {
                    useToasts.getState().show({ kind: 'error', title: 'Could not read GPT-Live settings', description: failureText(error) });
                }
            });
        return () => {
            current = false;
        };
    }, [bridge]);

    useEffect(() => {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices) {
            return;
        }
        let current = true;
        let permission: PermissionStatus | null = null;
        const refresh = (): void => {
            void listMicrophones()
                .then((devices) => {
                    if (current) {
                        setMicrophones(devices);
                        setMicrophonesAvailable(true);
                    }
                })
                .catch(() => {
                    if (current) {
                        setMicrophonesAvailable(false);
                    }
                });
        };
        refresh();
        mediaDevices.addEventListener('devicechange', refresh);
        void navigator.permissions
            ?.query({ name: 'microphone' as PermissionName })
            .then((status) => {
                if (!current) {
                    return;
                }
                permission = status;
                permission.addEventListener('change', refresh);
            })
            .catch(() => undefined);
        return () => {
            current = false;
            mediaDevices.removeEventListener('devicechange', refresh);
            permission?.removeEventListener('change', refresh);
        };
    }, []);

    const microphoneItems = [
        { value: DEFAULT_MICROPHONE_ID, label: 'System default', description: 'Follows the macOS input selection' },
        ...microphones.map((device) => ({ value: device.id, label: device.label })),
        ...(microphoneId !== DEFAULT_MICROPHONE_ID && !microphones.some((device) => device.id === microphoneId)
            ? [{ value: microphoneId, label: 'Unavailable microphone', description: 'Uses the system default until it returns', disabled: true }]
            : [])
    ];

    async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!bridge || draft.trim() === '') {
            return;
        }
        setBusy(true);
        try {
            const next = await bridge.saveApiKey(draft);
            setStatus(next);
            useVoice.getState().setCredential(next);
            setDraft('');
            useToasts.getState().show({ kind: 'success', title: 'OpenAI API key saved' });
        } catch (error) {
            useToasts.getState().show({ kind: 'error', title: 'Could not save the API key', description: failureText(error) });
        } finally {
            setBusy(false);
        }
    }

    async function remove(): Promise<void> {
        if (!bridge) {
            return;
        }
        setBusy(true);
        try {
            const next = await bridge.clearApiKey();
            closeVoicePanel();
            setStatus(next);
            useVoice.getState().setCredential(next);
            setDraft('');
            useToasts.getState().show({ kind: 'success', title: 'Saved OpenAI API key removed' });
        } catch (error) {
            useToasts.getState().show({ kind: 'error', title: 'Could not remove the API key', description: failureText(error) });
        } finally {
            setBusy(false);
        }
    }

    if (!bridge) {
        return (
            <SettingsSection title="OpenAI GPT-Live">
                <SettingsRow muted label="API key" description="API keys can be configured in the Ruimte desktop app." />
            </SettingsSection>
        );
    }

    return (
        <>
            <SettingsSection
                title="OpenAI GPT-Live"
                description="A separate project key is recommended for tracking and revocation."
                action={
                    <Button variant="secondary" size="sm" href="https://platform.openai.com/api-keys">
                        Create API key
                    </Button>
                }
            >
                <SettingsRow
                    label="API key"
                    description={displayStatus ? descriptionFor(displayStatus) : 'Checking the desktop keychain…'}
                    control={
                        displayStatus ? (
                            <Badge tone={displayStatus.configured ? 'accent' : 'muted'}>{displayStatus.configured ? 'Configured' : 'Not configured'}</Badge>
                        ) : (
                            <Skeleton className="w-20" />
                        )
                    }
                >
                    <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={(event) => void save(event)}>
                        <label className="sr-only" htmlFor="openai-api-key">
                            OpenAI API key
                        </label>
                        <input
                            id="openai-api-key"
                            className="field min-w-0 flex-1 basis-64 font-mono"
                            type="password"
                            autoComplete="off"
                            placeholder={displayStatus?.configured ? 'Enter a replacement key' : 'sk-…'}
                            value={draft}
                            disabled={busy}
                            spellCheck={false}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => event.stopPropagation()}
                        />
                        <Button type="submit" disabled={busy || draft.trim() === ''}>
                            Save
                        </Button>
                        {displayStatus?.configured && (
                            <Tooltip label="Remove saved API key" name>
                                <button type="button" className="icon-btn h-8 w-8 shrink-0" disabled={busy} onClick={() => void remove()}>
                                    <Icon icon={Trash2} size={14} />
                                </button>
                            </Tooltip>
                        )}
                    </form>
                </SettingsRow>
            </SettingsSection>
            <SettingsSection
                title="Conversation"
                description="Changes apply when you start the next conversation. Only an active conversation sends microphone audio to OpenAI."
            >
                <SettingsRow
                    label="Microphone"
                    description={
                        microphonesAvailable
                            ? 'Input used for new conversations. Nearby iPhones appear when macOS makes them available.'
                            : 'Microphones could not be listed. New conversations use the system default.'
                    }
                    control={
                        <Select
                            value={microphoneId}
                            items={microphoneItems}
                            label="Conversation microphone"
                            align="end"
                            className="max-w-72"
                            onValueChange={(voiceInputDeviceId) => updateSettings({ voiceInputDeviceId })}
                        />
                    }
                />
                <SettingsRow
                    label="Language"
                    description="The language Ruimte listens and replies in."
                    control={
                        <Select
                            value={language}
                            items={VOICE_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))}
                            label="Conversation language"
                            align="end"
                            onValueChange={(voiceLanguage) => updateSettings({ voiceLanguage })}
                        />
                    }
                />
                <SettingsRow
                    label="Voice"
                    description="OpenAI's built-in Live voices. Marin and Cedar are recommended."
                    control={
                        <Select
                            value={voice}
                            items={LIVE_VOICES.map((item) => ({
                                value: item,
                                label: titleCase(item),
                                description: item === 'marin' ? 'Default · recommended' : item === 'cedar' ? 'Recommended' : undefined
                            }))}
                            label="Conversation voice"
                            align="end"
                            onValueChange={(liveVoice) => updateSettings({ liveVoice })}
                        />
                    }
                />
            </SettingsSection>
        </>
    );
}
