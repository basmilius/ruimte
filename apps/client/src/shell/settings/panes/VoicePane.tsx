import { LIVE_VOICES } from '@ruimte/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import i18next from 'i18next';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageOf, Skeleton, Switch, Pill, Button, IconButton, Input, Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { desktop, type OpenAiCredentialStatus } from '@/desktop/bridge';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useVoice } from '@/voice/state';
import { closeVoicePanel, stopVoice } from '@/voice/controller';
import { DictationSection } from './DictationSection';
import { VoiceInputSection } from './VoiceInputSection';

function titleCase(value: string): string {
    return value[0]!.toUpperCase() + value.slice(1);
}

function descriptionFor(status: OpenAiCredentialStatus): string {
    if (status.configured && status.persistent) {
        return i18next.t('settings:voice.key.persistent');
    }
    if (status.configured) {
        return i18next.t('settings:voice.key.session');
    }
    return i18next.t('settings:voice.key.missing');
}

export function VoicePane() {
    const { t } = useTranslation('settings');
    const [status, setStatus] = useState<OpenAiCredentialStatus | null>(null);
    const [readError, setReadError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const bridge = desktop()?.openAi;
    const sharedStatus = useVoice((state) => state.credential);
    const displayStatus = sharedStatus ?? status;
    const voice = useSettings((state) => state.liveVoice);
    const confirmDestructiveActions = useSettings((state) => state.voiceConfirmDestructiveActions);
    const updateSettings = useSettings((state) => state.update);

    useEffect(() => {
        let current = true;
        bridge
            ?.credentialStatus()
            .then((next) => {
                if (current) {
                    setReadError(null);
                    setStatus(next);
                    useVoice.getState().setCredential(next);
                }
            })
            .catch((error: unknown) => {
                if (current) {
                    setReadError(messageOf(error, i18next.t('settings:voice.key.readFailure')));
                }
            });
        return () => {
            current = false;
        };
    }, [bridge, attempt]);

    const adopt = (next: OpenAiCredentialStatus): void => {
        setStatus(next);
        useVoice.getState().setCredential(next);
        setDraft('');
    };

    const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!bridge || draft.trim() === '') {
            return;
        }
        setBusy(true);
        try {
            adopt(await bridge.saveApiKey(draft));
            useToasts.getState().show({ kind: 'success', title: t('voice.toast.saved') });
        } catch (error) {
            useToasts.getState().show({ kind: 'error', title: t('voice.toast.saveFailed'), description: messageOf(error, t('voice.key.saveFailure')) });
        } finally {
            setBusy(false);
        }
    };

    const remove = async (): Promise<void> => {
        if (!bridge) {
            return;
        }
        setBusy(true);
        try {
            const next = await bridge.clearApiKey();
            stopVoice();
            closeVoicePanel();
            adopt(next);
            useToasts.getState().show({ kind: 'success', title: t('voice.toast.removed') });
        } catch (error) {
            useToasts.getState().show({ kind: 'error', title: t('voice.toast.removeFailed'), description: messageOf(error, t('voice.key.removeFailure')) });
        } finally {
            setBusy(false);
        }
    };

    if (!bridge) {
        return (
            <>
                <VoiceInputSection />
                <DictationSection />
                <SettingsSection title={t('voice.key.title')}>
                    <SettingsRow searchId="voice.key" muted label={t('voice.key.label')} description={t('voice.key.desktopOnly')} />
                </SettingsSection>
            </>
        );
    }

    return (
        <>
            <VoiceInputSection />
            <DictationSection />
            <SettingsSection
                title={t('voice.key.title')}
                description={t('voice.key.sectionDescription')}
                action={
                    <Button variant="secondary" href="https://platform.openai.com/api-keys">
                        {t('voice.key.create')}
                    </Button>
                }
            >
                <SettingsRow
                    searchId="voice.key"
                    label={t('voice.key.label')}
                    description={readError ?? (displayStatus ? descriptionFor(displayStatus) : t('voice.key.checking'))}
                    control={
                        readError ? (
                            <Button
                                size="sm"
                                onClick={() => {
                                    setReadError(null);
                                    setAttempt((value) => value + 1);
                                }}
                            >
                                {t('common:action.retry')}
                            </Button>
                        ) : displayStatus ? (
                            <Pill shape="tag" tone={displayStatus.configured ? 'accent' : 'muted'}>
                                {displayStatus.configured ? t('voice.key.configured') : t('voice.key.notConfigured')}
                            </Pill>
                        ) : (
                            <Skeleton className="w-20" />
                        )
                    }
                >
                    <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={(event) => void save(event)}>
                        <label className="sr-only" htmlFor="openai-api-key">
                            {t('voice.key.fieldLabel')}
                        </label>
                        <Input
                            id="openai-api-key"
                            mono
                            className="min-w-0 flex-1 basis-64"
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
                            <IconButton icon={Trash2} label={t('voice.key.remove')} className="shrink-0" disabled={busy} onClick={() => void remove()} />
                        )}
                    </form>
                </SettingsRow>

                <SettingsRow
                    searchId="voice.voice"
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
                    searchId="voice.confirm"
                    label={t('voice.conversation.confirm.label')}
                    description={t('voice.conversation.confirm.description')}
                    control={
                        <Switch
                            checked={confirmDestructiveActions}
                            label={t('voice.conversation.confirm.toggle')}
                            onCheckedChange={(voiceConfirmDestructiveActions) => updateSettings({ voiceConfirmDestructiveActions })}
                        />
                    }
                />
            </SettingsSection>
        </>
    );
}
