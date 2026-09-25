import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { desktop, type BackgroundServiceState } from '@/desktop/bridge';
import { pendingRestartLine } from '@/shell/machine-update';
import { ConfirmDialog } from '@/shell/settings/ConfirmDialog';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { backgroundServiceRow } from '@/shell/settings/background-service';
import { Toggle } from '@/shell/settings/controls';
import { Button } from '@/ui/Button';
import { FORM_ERROR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

type Confirming = 'stop' | 'linger' | 'restart' | null;

/*
 * Whether "This machine" outlives the app. Drawn only where the shell carries the bridge for it, so a
 * browser tab and the web client never see a switch they cannot honor.
 */
export function BackgroundServiceSection() {
    const { t } = useTranslation('settings');
    const bridge = desktop()?.backgroundService ?? null;
    const [state, setState] = useState<BackgroundServiceState | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState<Confirming>(null);

    useEffect(() => {
        if (!bridge) {
            return;
        }
        let live = true;
        void bridge.state().then((next) => {
            if (live) {
                setState(next);
            }
        });
        const off = bridge.onState(setState);
        return () => {
            live = false;
            off();
        };
    }, [bridge]);

    if (!bridge || !state) {
        return null;
    }
    const row = backgroundServiceRow(state);
    const restartLine = pendingRestartLine(state);

    const setKeepRunning = async (keepRunning: boolean): Promise<void> => {
        setBusy(true);
        try {
            setState(await bridge.setKeepRunning(keepRunning));
        } finally {
            setBusy(false);
        }
    };

    return (
        <SettingsSection title={t('backgroundService.title')} scope="computer">
            <SettingsRow
                searchId="machines.machine.keepRunning"
                label={t('backgroundService.keepRunning.label')}
                description={row.unavailable ?? t('backgroundService.keepRunning.description')}
                muted={row.toggle === null}
                control={
                    row.toggle && (
                        <Toggle
                            checked={row.toggle.checked}
                            disabled={busy}
                            onChange={(checked) => void setKeepRunning(checked)}
                            label={t('backgroundService.keepRunning.label')}
                        />
                    )
                }
            />
            {row.pending && <p className="px-4.5 pb-3 text-xs break-words text-text-muted">{row.pending}</p>}
            {restartLine && bridge.restartNow && (
                <SettingsRow
                    label={t('backgroundService.restart.label')}
                    description={restartLine}
                    control={
                        <Button variant="secondary" onClick={() => setConfirming('restart')}>
                            {t('backgroundService.restart.action')}
                        </Button>
                    }
                />
            )}
            {row.failure && (
                <p className={`${FORM_ERROR} px-4.5 pb-3 break-words`} role="alert">
                    {t('backgroundService.failure', { reason: row.failure })}
                </p>
            )}
            {(row.offerLinger || row.lingerOn) && (
                <SettingsRow
                    label={t('backgroundService.linger.label')}
                    description={row.lingerOn ? t('backgroundService.linger.on') : t('backgroundService.linger.off')}
                    control={
                        row.offerLinger && (
                            <Button variant="secondary" onClick={() => setConfirming('linger')}>
                                {t('backgroundService.linger.action')}
                            </Button>
                        )
                    }
                />
            )}
            {row.canStop && (
                <SettingsRow
                    label={t('backgroundService.stop.label')}
                    description={t('backgroundService.stop.description')}
                    control={
                        <Button variant="secondary" onClick={() => setConfirming('stop')}>
                            <Icon icon={Power} size={12} /> {t('backgroundService.stop.action')}
                        </Button>
                    }
                />
            )}
            <ConfirmDialog
                open={confirming === 'stop'}
                onOpenChange={(next) => setConfirming(next ? 'stop' : null)}
                title={t('backgroundService.confirmStop.title')}
                description={t('backgroundService.confirmStop.description')}
                confirmLabel={t('backgroundService.confirmStop.action')}
                onConfirm={async () => bridge.stopMachine()}
            />
            <ConfirmDialog
                open={confirming === 'restart'}
                onOpenChange={(next) => setConfirming(next ? 'restart' : null)}
                title={t('backgroundService.confirmRestart.title')}
                description={t('backgroundService.confirmRestart.description')}
                confirmLabel={t('backgroundService.confirmRestart.action')}
                onConfirm={async () => {
                    const next = await bridge.restartNow?.();
                    if (next) {
                        setState(next);
                        if (next.failure) {
                            throw new Error(next.failure);
                        }
                    }
                }}
            />
            <ConfirmDialog
                open={confirming === 'linger'}
                onOpenChange={(next) => setConfirming(next ? 'linger' : null)}
                title={t('backgroundService.confirmLinger.title')}
                description={t('backgroundService.confirmLinger.description')}
                confirmLabel={t('backgroundService.confirmLinger.action')}
                onConfirm={async () => {
                    const next = await bridge.enableLinger();
                    setState(next);
                    if (next.failure) {
                        throw new Error(next.failure);
                    }
                }}
            />
        </SettingsSection>
    );
}
