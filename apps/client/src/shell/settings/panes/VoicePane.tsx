import { useEffect, useState, type FormEvent } from 'react';
import i18next from 'i18next';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { desktop, type OpenAiCredentialStatus } from '@/desktop/bridge';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Badge, Skeleton, Toggle } from '@/shell/settings/controls';
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

const failureText = (error: unknown): string => (error instanceof Error ? error.message : i18next.t('settings:voice.key.saveFailure'));

const titleCase = (value: string): string => value[0]!.toUpperCase() + value.slice(1);

const descriptionFor = (status: OpenAiCredentialStatus): string => {
    if (status.configured && status.persistent) {
        return i18next.t('settings:voice.key.persistent');
    }
    if (status.configured) {
        return i18next.t('settings:voice.key.session');
    }
    return i18next.t('settings:voice.key.missing');
};

export function VoicePane() {
    const { t } = useTranslation('settings');
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
    const confirmDestructiveActions = useSettings((state) => state.voiceConfirmDestructiveActions);
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
                    // Read off i18next rather than the hook's `t`, which would make the language a reason to ask again.
                    useToasts.getState().show({ kind: 'error', title: i18next.t('settings:voice.toast.readFailed'), description: failureText(error) });
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
        { value: DEFAULT_MICROPHONE_ID, label: t('voice.microphone.systemDefault'), description: t('voice.microphone.systemDefaultHint') },
        ...microphones.map((device) => ({ value: device.id, label: device.label })),
        ...(microphoneId !== DEFAULT_MICROPHONE_ID && !microphones.some((device) => device.id === microphoneId)
            ? [{ value: microphoneId, label: t('voice.microphone.unavailable'), description: t('voice.microphone.unavailableHint'), disabled: true }]
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
            useToasts.getState().show({ kind: 'success', title: t('voice.toast.saved') });
        } catch (error) {
            useToasts.getState().show({ kind: 'error', title: t('voice.toast.saveFailed'), description: failureText(error) });
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
            useToasts.getState().show({ kind: 'success', title: t('voice.toast.removed') });
        } catch (error) {
            useToasts.getState().show({ kind: 'error', title: t('voice.toast.removeFailed'), description: failureText(error) });
        } finally {
            setBusy(false);
        }
    }

    if (!bridge) {
        return (
            <SettingsSection title={t('voice.key.title')}>
                <SettingsRow muted label={t('voice.key.label')} description={t('voice.key.desktopOnly')} />
            </SettingsSection>
        );
    }

    return (
        <>
            <SettingsSection
                title={t('voice.key.title')}
                description={t('voice.key.sectionDescription')}
                action={
                    <Button variant="secondary" size="sm" href="https://platform.openai.com/api-keys">
                        {t('voice.key.create')}
                    </Button>
                }
            >
                <SettingsRow
                    label={t('voice.key.label')}
                    description={displayStatus ? descriptionFor(displayStatus) : t('voice.key.checking')}
                    control={
                        displayStatus ? (
                            <Badge tone={displayStatus.configured ? 'accent' : 'muted'}>
                                {displayStatus.configured ? t('voice.key.configured') : t('voice.key.notConfigured')}
                            </Badge>
                        ) : (
                            <Skeleton className="w-20" />
                        )
                    }
                >
                    <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={(event) => void save(event)}>
                        <label className="sr-only" htmlFor="openai-api-key">
                            {t('voice.key.fieldLabel')}
                        </label>
                        <input
                            id="openai-api-key"
                            className="field min-w-0 flex-1 basis-64 font-mono"
                            type="password"
                            autoComplete="off"
                            placeholder={displayStatus?.configured ? t('voice.key.replacePlaceholder') : 'sk-…'}
                            value={draft}
                            disabled={busy}
                            spellCheck={false}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => event.stopPropagation()}
                        />
                        <Button type="submit" disabled={busy || draft.trim() === ''}>
                            {t('common:action.save')}
                        </Button>
                        {displayStatus?.configured && (
                            <Tooltip label={t('voice.key.remove')} name>
                                <button type="button" className="icon-btn h-8 w-8 shrink-0" disabled={busy} onClick={() => void remove()}>
                                    <Icon icon={Trash2} size={14} />
                                </button>
                            </Tooltip>
                        )}
                    </form>
                </SettingsRow>
            </SettingsSection>
            <SettingsSection title={t('voice.conversation.title')} description={t('voice.conversation.description')}>
                <SettingsRow
                    label={t('voice.conversation.microphone.label')}
                    description={
                        microphonesAvailable ? t('voice.conversation.microphone.description') : t('voice.conversation.microphone.unavailableDescription')
                    }
                    control={
                        <Select
                            value={microphoneId}
                            items={microphoneItems}
                            label={t('voice.conversation.microphone.selectLabel')}
                            align="end"
                            className="max-w-72"
                            onValueChange={(voiceInputDeviceId) => updateSettings({ voiceInputDeviceId })}
                        />
                    }
                />
                <SettingsRow
                    label={t('voice.conversation.language.label')}
                    description={t('voice.conversation.language.description')}
                    control={
                        <Select
                            value={language}
                            items={VOICE_LANGUAGES.map((item) => ({ value: item.id, label: item.label }))}
                            label={t('voice.conversation.language.selectLabel')}
                            align="end"
                            onValueChange={(voiceLanguage) => updateSettings({ voiceLanguage })}
                        />
                    }
                />
                <SettingsRow
                    label={t('voice.conversation.voice.label')}
                    description={t('voice.conversation.voice.description')}
                    control={
                        <Select
                            value={voice}
                            items={LIVE_VOICES.map((item) => ({
                                value: item,
                                label: titleCase(item),
                                description:
                                    item === 'marin'
                                        ? t('voice.conversation.voice.default')
                                        : item === 'cedar'
                                          ? t('voice.conversation.voice.recommended')
                                          : undefined
                            }))}
                            label={t('voice.conversation.voice.selectLabel')}
                            align="end"
                            onValueChange={(liveVoice) => updateSettings({ liveVoice })}
                        />
                    }
                />
                <SettingsRow
                    label={t('voice.conversation.confirm.label')}
                    description={t('voice.conversation.confirm.description')}
                    control={
                        <Toggle
                            checked={confirmDestructiveActions}
                            label={t('voice.conversation.confirm.toggle')}
                            onChange={(voiceConfirmDestructiveActions) => updateSettings({ voiceConfirmDestructiveActions })}
                        />
                    }
                />
            </SettingsSection>
        </>
    );
}
