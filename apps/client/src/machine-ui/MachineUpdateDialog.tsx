import { Button, Dialog } from '@adecore/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop, type BackgroundServiceState, type DaemonCrash } from '@/desktop/bridge';
import { machineCrashToast } from '@/machine-ui/machine-crash';
import { machineUpdateAnswer, machineUpdatePrompt, useMachineUpdateAgain, type MachineUpdateAnswer } from '@/machine-ui/machine-update';
import { useToasts } from '@/state/toasts';

/*
 * Asked after an update when the background service still runs the older build, because a restart
 * would have ended the terminals and agents running on it, and again from the rail's mark until the
 * machine restarted. Mounted once beside the toasts, and only inside the desktop app, where the
 * shell carries the restart out.
 */
export function MachineUpdateDialog() {
    const { t } = useTranslation('shell');
    const bridge = desktop()?.backgroundService ?? null;
    const [state, setState] = useState<BackgroundServiceState | null>(null);
    const [busy, setBusy] = useState(false);
    const again = useMachineUpdateAgain((s) => s.again);

    useEffect(() => {
        if (!bridge) {
            return;
        }
        let live = true;
        let crash: DaemonCrash | null = null;
        // The same state tells this window when the machine it runs ended by itself.
        const receive = (next: BackgroundServiceState): void => {
            const toast = machineCrashToast(crash, next.crash ?? null);
            crash = next.crash ?? null;
            if (toast) {
                useToasts.getState().show(toast);
            }
            if (!next.pendingRestart) {
                useMachineUpdateAgain.setState({ again: null });
            }
            setState(next);
        };
        void bridge.state().then((next) => {
            if (live) {
                setState(next);
                crash = next.crash ?? null;
            }
        });
        const off = bridge.onState(receive);
        return () => {
            live = false;
            off();
        };
    }, [bridge]);

    const prompt = bridge ? machineUpdatePrompt(state, bridge, again) : null;
    if (!bridge || prompt === null) {
        return null;
    }

    const answer = async (choice: MachineUpdateAnswer): Promise<void> => {
        setBusy(true);
        try {
            const next = choice === 'restart-now' ? await bridge.restartNow?.() : await bridge.restartWhenIdle?.();
            if (next) {
                setState(next);
            }
        } finally {
            useMachineUpdateAgain.setState({ again: null });
            setBusy(false);
        }
    };

    return (
        <Dialog.Root
            open
            onOpenChange={(open) => {
                if (!open && !busy) {
                    void answer(machineUpdateAnswer('dismiss'));
                }
            }}
        >
            <Dialog.Popup size="sm" nested>
                <Dialog.Title className="break-words">{prompt.title}</Dialog.Title>
                <Dialog.Description className="mt-1 break-words">{prompt.description}</Dialog.Description>
                <Dialog.Footer>
                    {/* The calm choice keeps the focus, so an Enter never ends the sessions on the machine. */}
                    <Button autoFocus disabled={busy} onClick={() => void answer(machineUpdateAnswer('idle'))}>
                        {t('machineUpdate.whenIdle')}
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => void answer(machineUpdateAnswer('restart'))}>
                        {t('machineUpdate.restartNow')}
                    </Button>
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
