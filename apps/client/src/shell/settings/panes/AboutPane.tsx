import { useEffect, useState } from 'react';
import i18next from 'i18next';
import { ArrowDown, ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, Copy, LoaderCircle, RefreshCw, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { desktop, isDesktop, type Release, type UpdateState } from '@/desktop/bridge';
import { formatDayWithYear } from '@ruimte/ui/format/datetime';
import { useFormatLocale } from '@ruimte/ui/format/locale';
import { SettingsRow, TopIcon } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented, Toggle } from '@/shell/settings/controls';
import { useServers, type ServerInfo } from '@/state/server';
import { useSettings } from '@/state/settings';
import { canShowReleaseNotes, ensureReleaseNotes, notesView, openReleaseNotes, useReleaseNotes } from '@/state/release-notes';
import { previewUpdate, type UpdatePreview } from '@/state/update-preview';
import { describeUpdate, hasUpdate, setAutoDownload, useUpdates } from '@/state/updates';
import { useFocusedMachine } from '@/transport/connections';
import { Button } from '@ruimte/ui/Button';
import { BrandSymbol } from '@/ui/Brand';
import { copyText } from '@ruimte/ui/clipboard';
import { Icon } from '@ruimte/ui/Icon';
import { Pill } from '@ruimte/ui/Pill';

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

/* Where the update stands, as an icon in the color of what it asks of you. */
const STATUS_ICONS: Record<UpdateState['status'], { icon: LucideIcon; className: string }> = {
    unsupported: { icon: CircleCheck, className: 'text-text-faint' },
    idle: { icon: CircleCheck, className: 'text-status-idle' },
    current: { icon: CircleCheck, className: 'text-status-idle' },
    checking: { icon: LoaderCircle, className: 'animate-spin text-text-muted' },
    available: { icon: ArrowDown, className: 'text-accent' },
    downloading: { icon: ArrowDown, className: 'text-accent' },
    ready: { icon: RefreshCw, className: 'text-accent' },
    error: { icon: CircleAlert, className: 'text-status-error' }
};

/* The release date of the version on offer, once the shell's copy of the notes knows it. */
const releasedOn = (releases: readonly Release[] | undefined, version: string | undefined): string | null => {
    const published = releases?.find((release) => release.version === version)?.publishedAt;
    const at = published ? new Date(published) : null;
    return at === null || Number.isNaN(at.getTime()) ? null : formatDayWithYear(at);
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
    // A browser has no app version of its own. It runs the client the machine serves.
    const version = isDesktop() && updates.currentVersion ? updates.currentVersion : server?.version;
    const releases = useReleaseNotes((s) => s.notes?.releases);
    const previousSeen = useReleaseNotes((s) => s.previousSeen);
    const withNotes = updates.supported && canShowReleaseNotes();
    const notesLink = withNotes ? notesView(releases ?? [], updates.currentVersion, updates, previousSeen).link : null;
    const offered = hasUpdate(updates);

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
            {import.meta.env.DEV && <UpdatePreviewBar />}
            <header className="flex min-w-0 flex-wrap items-center gap-4.5 rounded-xl border border-border bg-surface bg-clip-padding p-5.5">
                <BrandSymbol size={64} className="rounded-2xl" />
                <div className="min-w-0 grow">
                    <h3 className="text-lg font-semibold text-text">Ruimte</h3>
                    <p className="mt-0.5 text-xs text-text-muted">{t('about.tagline')}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <span className="text-xs text-text-muted tabular-nums">{t('about.version', { version: version ?? t('about.unknownVersion') })}</span>
                    {offered && (
                        <Pill shape="tag" tone="accent">
                            {t(`about.status.${updates.status}`)}
                        </Pill>
                    )}
                </div>
            </header>
            {updates.supported && (
                <SettingsSection title={t('about.updates.title')} description={t('about.updates.description')}>
                    <UpdateStatusRow releases={releases} notesVersion={notesLink?.version ?? null} />
                    <SettingsRow
                        searchId="about.updates.auto"
                        label={t('about.updates.auto.label')}
                        description={t('about.updates.auto.description')}
                        control={<Toggle checked={autoDownload} onChange={setAuto} label={t('about.updates.auto.label')} />}
                    />
                </SettingsSection>
            )}
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
                            <span className={row.mono ? 'max-w-72 truncate font-mono text-code text-text-muted' : 'text-xs text-text-muted'}>{row.value}</span>
                        }
                    />
                ))}
            </SettingsSection>
            <SettingsSection title={t('about.links.title')}>
                {LINKS.map((link) => (
                    <SettingsRow
                        key={link.href}
                        label={t(`about.links.${link.id}.label`)}
                        description={t(`about.links.${link.id}.description`)}
                        control={
                            <Button variant="secondary" size="sm" href={link.href}>
                                {t('common:action.open')} <Icon icon={ArrowUpRight} size={12} />
                            </Button>
                        }
                    />
                ))}
            </SettingsSection>
            <p className="text-center text-xs text-text-faint">FSL-1.1-MIT · Copyright 2026 Bas Milius</p>
        </>
    );
}

interface UpdateStatusRowProps {
    releases: readonly Release[] | undefined;
    /* The version the notes open on, or null where there are none to open. They never show here. */
    notesVersion: string | null;
}

/* The first row of Updates: where the update stands, a link to what is new in it, and what to do next. */
function UpdateStatusRow({ releases, notesVersion }: UpdateStatusRowProps) {
    const { t } = useTranslation('settings');
    const updates = useUpdates();
    useFormatLocale();
    const { headline, detail } = describeUpdate(updates);
    const status = STATUS_ICONS[updates.status];
    const percent = Math.min(100, Math.max(0, updates.percent ?? 0));
    const released = updates.status === 'available' ? releasedOn(releases, updates.version) : null;
    const line = released === null ? detail : t('about.updates.released', { date: released });

    return (
        <div className="flex min-w-0 flex-col gap-3 px-4.5 py-3.5">
            <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
                <div className="flex min-w-0 grow basis-60 items-start gap-3">
                    <TopIcon icon={status.icon} size={20} className={status.className} />
                    <div className="min-w-0 grow">
                        <div className="text-sm text-text">{headline}</div>
                        {line && <div className="mt-0.5 text-xs text-text-muted tabular-nums">{line}</div>}
                        {notesVersion !== null && (
                            <button
                                type="button"
                                className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                                onClick={() => openReleaseNotes(notesVersion)}
                            >
                                {t('about.updates.whatsNew', { version: notesVersion })}
                                <Icon icon={ArrowRight} size={12} />
                            </button>
                        )}
                    </div>
                </div>
                <UpdateAction />
            </div>
            {updates.status === 'downloading' && (
                <div
                    role="progressbar"
                    aria-label={headline}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(percent)}
                    className="ml-8 h-1 overflow-hidden rounded-full bg-surface-sunken"
                >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
                </div>
            )}
        </div>
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

const PREVIEWS: readonly { id: UpdatePreview; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'current', label: 'Up to date' },
    { id: 'available', label: 'Available' },
    { id: 'downloading', label: 'Downloading' },
    { id: 'ready', label: 'Ready' },
    { id: 'error', label: 'Failed' }
];

/* Dev only, and in English only: steps About through the update states a checkout never reaches. */
function UpdatePreviewBar() {
    const [preview, setPreview] = useState<UpdatePreview>('off');

    // The preview names the newest release, so the notes have to be in before the first pick.
    useEffect(() => {
        if (canShowReleaseNotes()) {
            ensureReleaseNotes();
        }
    }, []);

    const choose = (next: UpdatePreview): void => {
        setPreview(next);
        previewUpdate(next);
    };
    return (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border-strong px-4 py-2.5">
            <span className="text-xs text-text-muted">Preview update state (dev only)</span>
            <Segmented value={preview} options={PREVIEWS} onChange={choose} label="Preview update state" />
        </div>
    );
}
