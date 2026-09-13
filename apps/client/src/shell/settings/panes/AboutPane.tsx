import { Copy, ExternalLink } from 'lucide-react';
import { desktop, isDesktop } from '@/desktop/bridge';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { useServers, type ServerInfo } from '@/state/server';
import { useSettings } from '@/state/settings';
import { describeUpdate, setAutoDownload, useUpdates } from '@/state/updates';
import { useFocusedConnection } from '@/transport/connections';
import { Button } from '@/ui/Button';
import { BrandSymbol } from '@/ui/Brand';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';

const TAGLINE = 'Space for AI Engineering.';

const LINKS = [
    { label: 'ruimte.app', description: 'The site, with the download and the principles.', href: 'https://ruimte.app' },
    { label: 'Source on GitHub', description: 'The code, the issues and the handoff notes.', href: 'https://github.com/basmilius/ruimte' },
    { label: 'Report a problem', description: 'A new issue with what you saw and what you expected.', href: 'https://github.com/basmilius/ruimte/issues/new' }
];

const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

interface Detail {
    label: string;
    value: string;
    description?: string;
    mono?: boolean;
}

/* The rows under the header, in the order a bug report wants them. The shell's versions are missing
   in a browser and in a shell that started before it passed them on. */
const detailsOf = (server: ServerInfo | undefined): Detail[] => {
    const versions = desktop()?.versions;
    const machine = server?.label ?? server?.model ?? 'Not connected';
    const rows: Detail[] = [
        {
            label: 'Machine',
            value: server?.version ? `${machine}, ${server.version}` : machine,
            description: 'The machine of the workspace you are in, and the version it runs.'
        }
    ];
    if (versions) {
        rows.push({ label: 'Electron', value: versions.electron }, { label: 'Chromium', value: versions.chrome }, { label: 'Node', value: versions.node });
    }
    const platform = server?.platform ?? null;
    rows.push(
        { label: 'Platform', value: platform ? (PLATFORM_NAMES[platform] ?? platform) : 'Unknown' },
        { label: 'Data folder', value: server?.home ?? 'Unknown', description: 'Sessions, chats, worktrees and the project registry live here.', mono: true }
    );
    return rows;
};

/* Who Ruimte is, which versions this window runs, and the one update button there is. */
export function AboutPane() {
    const endpointId = useFocusedConnection().endpointId;
    const server = useServers((s) => s.byEndpoint[endpointId]);
    const updates = useUpdates();
    const autoDownload = useSettings((s) => s.updatesAutoDownload);
    const update = useSettings((s) => s.update);
    const details = detailsOf(server);
    const { headline, detail } = describeUpdate(updates);
    // A browser has no app version of its own: it runs the client the machine serves.
    const version = isDesktop() && updates.currentVersion ? updates.currentVersion : server?.version;

    const setAuto = (checked: boolean): void => {
        update({ updatesAutoDownload: checked });
        void setAutoDownload(checked);
    };

    const copyDetails = (): void => {
        const lines = [`Ruimte ${version ?? 'unknown'}`, ...details.map((row) => `${row.label}: ${row.value}`)];
        copyText(lines.join('\n'));
    };

    return (
        <>
            <header className="flex flex-col items-center gap-1 pt-2 pb-1 text-center">
                <BrandSymbol size={48} />
                <h3 className="mt-2 text-lg font-semibold text-text">Ruimte</h3>
                <p className="text-sm text-text-muted">{TAGLINE}</p>
                <p className="mt-2 text-sm text-text">
                    Version {version ?? 'unknown'}
                    {updates.supported && <span className="text-text-muted"> · {headline}</span>}
                </p>
                {updates.supported && detail && <p className="max-w-96 text-xs text-text-muted">{detail}</p>}
                {updates.supported && (
                    <div className="mt-2">
                        <UpdateAction />
                    </div>
                )}
            </header>
            <SettingsSection
                title="Details"
                action={
                    <Button variant="secondary" onClick={copyDetails}>
                        <Icon icon={Copy} size={12} /> Copy details
                    </Button>
                }
            >
                {details.map((row) => (
                    <SettingsRow
                        key={row.label}
                        label={row.label}
                        description={row.description}
                        control={
                            <span className={row.mono ? 'max-w-72 truncate font-mono text-code text-text-muted' : 'text-sm text-text-muted'}>{row.value}</span>
                        }
                    />
                ))}
            </SettingsSection>
            {updates.supported && (
                <SettingsSection title="Updates" description="Downloading is separate from installing; nothing restarts without you.">
                    <SettingsRow
                        label="Download updates automatically"
                        description="On, a new version comes down in the background and the toolbar turns green once it is ready to install. Off, the button appears as soon as there is one and you start the download yourself."
                        control={<Toggle checked={autoDownload} onChange={setAuto} label="Download updates automatically" />}
                    />
                </SettingsSection>
            )}
            <SettingsSection title="Links">
                {LINKS.map((link) => (
                    <SettingsRow
                        key={link.href}
                        label={link.label}
                        description={link.description}
                        control={
                            <Button variant="secondary" href={link.href}>
                                Open <Icon icon={ExternalLink} size={12} />
                            </Button>
                        }
                    />
                ))}
            </SettingsSection>
            <p className="text-center text-xs text-text-faint">FSL-1.1-MIT · Copyright 2026 Bas Milius</p>
        </>
    );
}

/* The one thing worth doing in the state the app is in. */
function UpdateAction() {
    const status = useUpdates((s) => s.status);
    const check = useUpdates((s) => s.check);
    const download = useUpdates((s) => s.download);
    const install = useUpdates((s) => s.install);

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
            {status === 'checking' ? 'Checking' : 'Check for updates'}
        </Button>
    );
}
