import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { useSettings } from '@/state/settings';
import { describeUpdate, setAutoDownload, useUpdates } from '@/state/updates';
import { Button } from '@/ui/Button';

/* What the app runs, what is on the other side, and the one button that closes the gap. */
export function UpdatesPane() {
    const state = useUpdates();
    const autoDownload = useSettings((s) => s.updatesAutoDownload);
    const update = useSettings((s) => s.update);
    const { headline, detail } = describeUpdate(state);

    const setAuto = (checked: boolean): void => {
        update({ updatesAutoDownload: checked });
        void setAutoDownload(checked);
    };

    return (
        <div className="flex flex-col gap-6">
            <SettingsSection title="Version" description="Where this app stands against the latest release.">
                <SettingsRow label={headline} description={detail || undefined} control={<Action />} />
                <SettingsRow
                    label="Installed"
                    description="The version running in this window."
                    muted
                    control={<span className="text-sm text-text-muted">{state.currentVersion || 'Unknown'}</span>}
                />
            </SettingsSection>
            {state.supported && (
                <SettingsSection title="How updates arrive" description="Downloading is separate from installing; nothing restarts without you.">
                    <SettingsRow
                        label="Download updates automatically"
                        description="On, a new version comes down in the background and the toolbar turns green once it is ready to install. Off, the button appears as soon as there is one and you start the download yourself."
                        control={<Toggle checked={autoDownload} onChange={setAuto} label="Download updates automatically" />}
                    />
                </SettingsSection>
            )}
        </div>
    );
}

/* The one thing worth doing in the state the app is in. */
function Action() {
    const status = useUpdates((s) => s.status);
    const check = useUpdates((s) => s.check);
    const download = useUpdates((s) => s.download);
    const install = useUpdates((s) => s.install);

    if (status === 'unsupported') {
        return null;
    }
    if (status === 'ready') {
        return (
            <Button variant="positive" onClick={install}>
                Restart to install
            </Button>
        );
    }
    if (status === 'available') {
        return (
            <Button variant="primary" onClick={() => void download()}>
                Download
            </Button>
        );
    }
    return (
        <Button variant="secondary" disabled={status === 'checking' || status === 'downloading'} onClick={() => void check()}>
            {status === 'checking' ? 'Checking' : 'Check now'}
        </Button>
    );
}
