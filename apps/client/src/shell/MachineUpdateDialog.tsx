import { useEffect, useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { desktop, type BackgroundServiceState } from '@/desktop/bridge';
import { machineUpdateAnswer, machineUpdatePrompt, type MachineUpdateAnswer } from '@/shell/machine-update';
import { Button } from '@/ui/Button';

/*
 * Asked after an update when the background service still runs the older build, because a restart
 * would have ended the terminals and agents running on it. Mounted once beside the toasts, and only
 * inside the desktop app, where the shell carries the restart out.
 */
export function MachineUpdateDialog() {
    const bridge = desktop()?.backgroundService ?? null;
    const [state, setState] = useState<BackgroundServiceState | null>(null);
    const [busy, setBusy] = useState(false);

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

    const prompt = bridge ? machineUpdatePrompt(state, bridge) : null;
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
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop dialog-backdrop-nested" forceRender />
                <Dialog.Popup className="dialog-popup dialog-popup-nested touch-roomy w-[400px] p-5">
                    <Dialog.Title className="text-base font-semibold break-words text-text">{prompt.title}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-xs break-words text-text-muted">{prompt.description}</Dialog.Description>
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                        <Button variant="danger" disabled={busy} onClick={() => void answer(machineUpdateAnswer('restart'))}>
                            Restart now
                        </Button>
                        <Button autoFocus disabled={busy} onClick={() => void answer(machineUpdateAnswer('idle'))}>
                            When idle
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
