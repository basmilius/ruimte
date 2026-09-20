import { useEffect } from 'react';
import i18next from 'i18next';
import { Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { desktop, isDesktop } from '@/desktop/bridge';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { useServers, type ServerInfo } from '@/state/server';
import { useSettings } from '@/state/settings';
import { canShowReleaseNotes, ensureReleaseNotes, notesView, openReleaseNotes, useReleaseNotes } from '@/state/release-notes';
import { describeUpdate, hasUpdate, setAutoDownload, useUpdates } from '@/state/updates';
import { useFocusedMachine } from '@/transport/connections';
import { Button } from '@/ui/Button';
import { BrandSymbol } from '@/ui/Brand';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';

/* The three links, each with its words under `about.links.<id>`. */
const LINKS = [
    { id: 'website', href: 'https://ruimte.app' },
    { id: 'source', href: 'https://github.com/basmilius/ruimte' },
    { id: 'report', href: 'https://github.com/basmilius/ruimte/issues/new' }
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
    const machine = server?.label ?? server?.model ?? i18next.t('settings:about.details.notConnected');
    const rows: Detail[] = [
        {
            label: i18next.t('settings:about.details.machine.label'),
            value: server?.version ? `${machine}, ${server.version}` : machine,
            description: i18next.t('settings:about.details.machine.description')
        }
    ];
    if (versions) {
        rows.push({ label: 'Electron', value: versions.electron }, { label: 'Chromium', value: versions.chrome }, { label: 'Node', value: versions.node });
    }
    const platform = server?.platform ?? null;
    const unknown = i18next.t('settings:about.details.unknown');
    rows.push(
        { label: i18next.t('settings:about.details.platform'), value: platform ? (PLATFORM_NAMES[platform] ?? platform) : unknown },
        {
            label: i18next.t('settings:about.details.dataFolder.label'),
            value: server?.home ?? unknown,
            description: i18next.t('settings:about.details.dataFolder.description'),
            mono: true
        }
    );
    return rows;
};

/* Who Ruimte is, which versions this window runs, and the one update button there is. */
export function AboutPane() {
    const { t } = useTranslation('settings');
    const endpointId = useFocusedMachine().endpointId;
    const server = useServers((s) => s.byEndpoint[endpointId]);
    const updates = useUpdates();
    const autoDownload = useSettings((s) => s.updatesAutoDownload);
    const update = useSettings((s) => s.update);
    const details = detailsOf(server);
    const { headline, detail } = describeUpdate(updates);
    // A browser has no app version of its own. It runs the client the machine serves.
    const version = isDesktop() && updates.currentVersion ? updates.currentVersion : server?.version;
    const releases = useReleaseNotes((s) => s.notes?.releases);
    const previousSeen = useReleaseNotes((s) => s.previousSeen);
    const withNotes = updates.supported && canShowReleaseNotes();
    const notesLink = withNotes ? notesView(releases ?? [], updates.currentVersion, updates, previousSeen).link : null;
    const updateOffered = hasUpdate(updates);

    useEffect(() => {
        if (withNotes) {
            ensureReleaseNotes();
        }
    }, [withNotes]);

    const setAuto = (checked: boolean): void => {
        update({ updatesAutoDownload: checked });
        void setAutoDownload(checked);
    };

    const copyDetails = (): void => {
        const lines = [`Ruimte ${version ?? t('about.unknownVersion')}`, ...details.map((row) => `${row.label}: ${row.value}`)];
        copyText(lines.join('\n'));
    };

    return (
        <>
            <header className="flex flex-col items-center gap-1 pt-2 pb-1 text-center">
                <BrandSymbol size={64} />
                <h3 className="mt-2 text-lg font-semibold text-text">Ruimte</h3>
                <p className="text-sm text-text-muted">{t('about.tagline')}</p>
                <p className="mt-2 text-sm text-text">
                    {t('about.version', { version: version ?? t('about.unknownVersion') })}
                    {updates.supported && <span className="text-text-muted"> · {headline}</span>}
                </p>
                {updates.supported && detail && <p className="max-w-96 text-xs text-text-muted">{detail}</p>}
                {notesLink && !updateOffered && <WhatsNewLink label={notesLink.label} version={notesLink.version} />}
                {updates.supported && (
                    <div className="mt-2 flex items-center gap-3">
                        <UpdateAction />
                        {notesLink && updateOffered && <WhatsNewLink label={notesLink.label} version={notesLink.version} />}
                    </div>
                )}
            </header>
            <SettingsSection
                title={t('about.details.title')}
                action={
                    <Button variant="secondary" onClick={copyDetails}>
                        <Icon icon={Copy} size={12} /> {t('about.details.copy')}
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
                <SettingsSection title={t('about.updates.title')} description={t('about.updates.description')}>
                    <SettingsRow
                        label={t('about.updates.auto.label')}
                        description={t('about.updates.auto.description')}
                        control={<Toggle checked={autoDownload} onChange={setAuto} label={t('about.updates.auto.label')} />}
                    />
                </SettingsSection>
            )}
            <SettingsSection title={t('about.links.title')}>
                {LINKS.map((link) => (
                    <SettingsRow
                        key={link.href}
                        label={t(`about.links.${link.id}.label`)}
                        description={t(`about.links.${link.id}.description`)}
                        control={
                            <Button variant="secondary" href={link.href}>
                                {t('common:action.open')} <Icon icon={ExternalLink} size={12} />
                            </Button>
                        }
                    />
                ))}
            </SettingsSection>
            <p className="text-center text-xs text-text-faint">FSL-1.1-MIT · Copyright 2026 Bas Milius</p>
        </>
    );
}

function WhatsNewLink({ label, version }: { label: string; version: string }) {
    return (
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => openReleaseNotes(version)}>
            {label}
        </button>
    );
}

/* The one thing worth doing in the state the app is in. */
export function UpdateAction() {
    const { t } = useTranslation('settings');
    const status = useUpdates((s) => s.status);
    const check = useUpdates((s) => s.check);
    const download = useUpdates((s) => s.download);
    const install = useUpdates((s) => s.install);

    if (status === 'ready') {
        return (
            <Button variant="positive" onClick={install}>
                {t('about.updates.install')}
            </Button>
        );
    }
    if (status === 'available') {
        return (
            <Button variant="primary" onClick={() => void download()}>
                {t('about.updates.download')}
            </Button>
        );
    }
    return (
        <Button variant="secondary" disabled={status === 'checking' || status === 'downloading'} onClick={() => void check()}>
            {status === 'checking' ? t('about.updates.checking') : t('about.updates.check')}
        </Button>
    );
}
