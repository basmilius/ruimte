import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop } from '@/desktop/bridge';
import { cancelDictation, observeSpeech, useDictation } from '@/dictation/controller';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { Button } from '@/ui/Button';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { formatNumber } from '@/format/number';

export function DictationSection() {
    const { t } = useTranslation('voice');
    return (
        <ErrorBoundary label={t('dictation.failed')} className="relative" compact>
            <Section />
        </ErrorBoundary>
    );
}
function Section() {
    const { t } = useTranslation('voice');
    const model = useDictation((state) => state.model);
    const [error, setError] = useState<string | null>(null);
    const [removing, setRemoving] = useState(false);
    const bridge = desktop()?.speech;
    useEffect(observeSpeech, []);
    const busy = model?.phase === 'downloading' || model?.phase === 'verifying';
    const percent = model && model.totalBytes > 0 ? Math.min(100, Math.max(0, (model.downloadedBytes / model.totalBytes) * 100)) : 0;
    const run = async (action: () => Promise<unknown>): Promise<void> => {
        setError(null);
        try {
            await action();
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
        }
    };
    return (
        <SettingsSection title={t('dictation.title')} description={t('dictation.description')}>
            <SettingsRow
                label={t('dictation.enable')}
                description={
                    !bridge?.state ? t('dictation.desktopOnly') : model?.phase === 'unavailable' ? t('dictation.unavailable') : t('dictation.downloadHint')
                }
                control={
                    <Toggle
                        checked={model?.enabled === true || busy}
                        disabled={!bridge?.state || !model || model.phase === 'unavailable' || removing}
                        label={t('dictation.enable')}
                        onChange={(enabled) => {
                            if (bridge) {
                                if (!enabled) {
                                    cancelDictation();
                                }
                                void run(() => bridge.setEnabled(enabled));
                            }
                        }}
                    />
                }
            >
                {busy && (
                    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-surface-raised px-3 py-2.5">
                        <div className="flex min-w-0 grow flex-col gap-2">
                            <div className="flex items-baseline justify-between gap-3 text-xs">
                                <span role="status" className="min-w-0 font-medium text-text">
                                    {model.phase === 'verifying' ? t('dictation.verifying') : t('dictation.download')}
                                </span>
                                <span className="shrink-0 tabular-nums text-text-muted">{formatNumber(percent)}%</span>
                            </div>
                            <div
                                role="progressbar"
                                aria-label={t('dictation.download')}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(percent)}
                                className="h-1 overflow-hidden rounded-full bg-border"
                            >
                                <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-text-muted">
                                {t('dictation.progress', {
                                    received: formatNumber(Math.round(model.downloadedBytes / 1_000_000)),
                                    total: formatNumber(Math.round(model.totalBytes / 1_000_000))
                                })}
                            </span>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                if (bridge) {
                                    cancelDictation();
                                    void run(() => bridge.setEnabled(false));
                                }
                            }}
                        >
                            {t('dictation.cancelDownload')}
                        </Button>
                    </div>
                )}
                {(error || model?.error) && (
                    <p role="alert" className="text-xs text-status-error">
                        {error || model?.error}
                    </p>
                )}
                {model?.phase === 'error' && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            if (bridge) {
                                void run(() => bridge.setEnabled(true));
                            }
                        }}
                    >
                        {t('dictation.retry')}
                    </Button>
                )}
                {model && !busy && model.downloadedBytes > 0 && (
                    <Button
                        variant="secondary"
                        size="sm"
                        className="self-start"
                        disabled={removing}
                        onClick={() => {
                            if (bridge) {
                                cancelDictation();
                                setRemoving(true);
                                void run(() => bridge.removeModel()).finally(() => setRemoving(false));
                            }
                        }}
                    >
                        {t('dictation.remove')}
                    </Button>
                )}
            </SettingsRow>
        </SettingsSection>
    );
}
