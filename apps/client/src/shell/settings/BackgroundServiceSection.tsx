import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import { desktop, type BackgroundServiceState } from '@/desktop/bridge';
import { ConfirmDialog } from '@/shell/settings/ConfirmDialog';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { backgroundServiceRow } from '@/shell/settings/background-service';
import { Toggle } from '@/shell/settings/controls';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

type Confirming = 'stop' | 'linger' | null;

/*
 * Whether This machine outlives the app. Drawn only where the shell carries the bridge for it, so a
 * browser tab and the web client never see a switch they cannot honor.
 */
export function BackgroundServiceSection() {
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

    const setKeepRunning = async (keepRunning: boolean): Promise<void> => {
        setBusy(true);
        try {
            setState(await bridge.setKeepRunning(keepRunning));
        } finally {
            setBusy(false);
        }
    };

    return (
        <SettingsSection title="When Ruimte quits">
            <SettingsRow
                label="Keep this machine running when Ruimte quits"
                description={
                    row.unavailable ??
                    'Sessions and agents keep working in the background, so this machine stays reachable from your other clients and the web.'
                }
                muted={row.toggle === null}
                control={
                    row.toggle && (
                        <Toggle
                            checked={row.toggle.checked}
                            disabled={busy}
                            onChange={(checked) => void setKeepRunning(checked)}
                            label="Keep this machine running when Ruimte quits"
                        />
                    )
                }
            />
            {row.pending && <p className="px-4 pb-3 text-xs break-words text-text-muted">{row.pending}</p>}
            {row.failure && (
                <p className="px-4 pb-3 text-xs break-words text-status-error" role="alert">
                    The background service did not run this machine: {row.failure}
                </p>
            )}
            {(row.offerLinger || row.lingerOn) && (
                <SettingsRow
                    label="Keep running after you log out"
                    description={
                        row.lingerOn
                            ? 'Lingering is on, so this machine keeps running after you log out.'
                            : 'Without it, this machine stops when you log out of your desktop session.'
                    }
                    control={
                        row.offerLinger && (
                            <Button variant="secondary" onClick={() => setConfirming('linger')}>
                                Allow
                            </Button>
                        )
                    }
                />
            )}
            {row.canStop && (
                <SettingsRow
                    label="Stop the machine"
                    description="Ends every session here and quits Ruimte. The machine starts again the next time you open Ruimte."
                    control={
                        <Button variant="secondary" onClick={() => setConfirming('stop')}>
                            <Icon icon={Power} size={12} /> Stop
                        </Button>
                    }
                />
            )}
            <ConfirmDialog
                open={confirming === 'stop'}
                onOpenChange={(next) => setConfirming(next ? 'stop' : null)}
                title="Stop this machine and quit Ruimte?"
                description="Every terminal and agent on this machine ends, and no other client can reach it until you open Ruimte again."
                confirmLabel="Stop and quit"
                onConfirm={async () => bridge.stopMachine()}
            />
            <ConfirmDialog
                open={confirming === 'linger'}
                onOpenChange={(next) => setConfirming(next ? 'linger' : null)}
                title="Keep running after you log out?"
                description="Ruimte runs loginctl enable-linger for your user, so your user services keep running without a session. Undo it with loginctl disable-linger."
                confirmLabel="Allow"
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
