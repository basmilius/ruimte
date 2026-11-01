import { createElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Store, type LucideIcon } from 'lucide-react';
import { Button, Icon, SectionLabel, Separator, Switch } from '@adecore/ui';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { MasterDetail, MasterItem, SettingsRow } from '@adecore/ui/settings';
import { desktop } from '@/desktop/bridge';
import { ExtensionTile } from '@/extensions/ExtensionTile';
import { extensionIconUrl, extensionsInSafeMode, syncExtensions, useInstalledExtensions } from '@/extensions/loader';
import { readDisabled } from '@/extensions/internal';
import { useContributions } from '@/extensions/registry';
import {
    installFromStore,
    readStore,
    removeExtension,
    setExtensionEnabled,
    storeIconUrl,
    type ExtensionStoreEntry,
    type StoreAnswer
} from '@/extensions/store';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useToasts } from '@/state/toasts';

const BROWSE = 'browse';
const DETAIL = 'flex min-w-0 flex-col gap-5';
const LIST_ROW_TILE = 20;
const HEADER_TILE = 48;

/* Above the cards, since a card only holds rows and text in it would run into its edges. */
function ExtensionHeader({
    icon,
    color,
    name,
    meta,
    description
}: {
    icon: string | LucideIcon | null | undefined;
    color: string | undefined;
    name: string;
    meta: readonly (string | false | undefined)[];
    description: string | undefined;
}) {
    return (
        <header className="flex min-w-0 items-start gap-3">
            <ExtensionTile icon={icon} color={color} size={HEADER_TILE} />
            <div className="min-w-0">
                <h3 className="text-sm font-medium text-text">{name}</h3>
                <p className="text-xs text-text-muted">{meta.filter(Boolean).join(', ')}</p>
                {description !== undefined && <p className="mt-1 text-sm text-text-muted">{description}</p>}
            </div>
        </header>
    );
}

function PermissionsSection({ permissions }: { permissions: Readonly<Record<string, string>> | undefined }) {
    const { t } = useTranslation('settings');
    const entries = Object.entries(permissions ?? {});

    return (
        <SettingsSection title={t('extensions.permissions')}>
            {entries.length === 0 ? (
                <SettingsRow label={t('extensions.noPermissions')} control={null} />
            ) : (
                entries.map(([permission, reason]) => <SettingsRow key={permission} label={reason} description={permission} control={null} />)
            )}
        </SettingsSection>
    );
}

function StoreDetail({ onShown }: { onShown: (id: string) => void }) {
    const { t } = useTranslation('settings');
    const [answer, setAnswer] = useState<StoreAnswer | null>(null);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<ExtensionStoreEntry | null>(null);

    useEffect(() => {
        void readStore().then(setAnswer);
    }, []);

    if (answer === null) {
        return null;
    }

    if (answer.kind === 'unavailable') {
        return <p className="text-sm text-text-muted">{t('extensions.storeUnavailable')}</p>;
    }

    if (open !== null) {
        return (
            <div className={DETAIL}>
                <ExtensionHeader
                    icon={storeIconUrl(open)}
                    color={open.color}
                    name={open.name}
                    meta={[open.publisher, open.version, open.reviewedAt && t('extensions.reviewed', { date: open.reviewedAt })]}
                    description={open.description}
                />
                <PermissionsSection permissions={open.permissions} />
                <p className="text-sm text-text-muted">{t('extensions.trust')}</p>
                <div className="flex gap-2">
                    <Button
                        variant="primary"
                        onClick={() => {
                            void installFromStore(open).then(
                                ({ onMachine }) => {
                                    if (!onMachine) {
                                        useToasts.getState().show({ kind: 'success', title: t('extensions.notOnMachine', { name: open.name }) });
                                    }

                                    onShown(open.id);
                                },
                                (e: unknown) =>
                                    useToasts
                                        .getState()
                                        .show({ kind: 'error', title: t('extensions.installFailed', { name: open.name }), description: String(e) })
                            );
                        }}
                    >
                        {t('extensions.install')}
                    </Button>
                    <Button onClick={() => setOpen(null)}>{t('extensions.back')}</Button>
                </div>
            </div>
        );
    }

    const shown = answer.entries.filter((entry) =>
        `${entry.name} ${entry.description ?? ''} ${entry.category ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
    );

    return (
        <div className={DETAIL}>
            <h3 className="text-sm font-medium text-text">{t('extensions.store')}</h3>
            <input
                aria-label={t('extensions.search')}
                placeholder={t('extensions.search')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-md border border-border bg-surface-sunken px-2 py-1 text-sm"
            />
            <ul className="flex flex-col gap-2">
                {shown.map((entry) => (
                    <li key={entry.id}>
                        <button
                            type="button"
                            className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-surface-hover"
                            onClick={() => setOpen(entry)}
                        >
                            <ExtensionTile icon={storeIconUrl(entry)} color={entry.color} size={LIST_ROW_TILE * 2} />
                            <span className="min-w-0">
                                <span className="block text-sm font-medium">{entry.name}</span>
                                <span className="block text-xs text-text-muted">{entry.publisher ?? entry.id}</span>
                                {entry.description !== undefined && <span className="mt-1 block text-sm text-text-muted">{entry.description}</span>}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function BuiltInDetail({ id }: { id: string }) {
    const { t } = useTranslation('settings');
    const entry = useContributions((state) => state.builtIns.find((each) => each.id === id));
    const [enabled, setEnabled] = useState(() => !readDisabled().includes(id));

    if (entry === undefined) {
        return null;
    }

    return (
        <div className={DETAIL}>
            <ExtensionHeader
                icon={entry.icon}
                color={entry.manifest.color}
                name={entry.manifest.name}
                meta={[t('extensions.included')]}
                description={entry.manifest.description}
            />
            <SettingsSection>
                <SettingsRow
                    label={t('extensions.enabled')}
                    control={
                        <Switch
                            checked={enabled}
                            label={t('extensions.enabled')}
                            onCheckedChange={(next) => {
                                entry.setEnabled(next);
                                setEnabled(next);
                            }}
                        />
                    }
                />
            </SettingsSection>
        </div>
    );
}

function InstalledDetail({ id, onRemoved }: { id: string; onRemoved: () => void }) {
    const { t } = useTranslation('settings');
    const entry = useInstalledExtensions((state) => state.installed.find((each) => each.manifest.id === id));
    const failure = useInstalledExtensions((state) => state.failures[id]);
    const settings = useContributions((state) => state.extensionSettings.find((each) => each.id === id));

    if (entry === undefined) {
        return null;
    }

    const { manifest } = entry;

    return (
        <div className={DETAIL}>
            {/* Ruimte's own: an extension draws only below this, so it cannot hide the way out. */}
            <ExtensionHeader
                icon={extensionIconUrl(entry)}
                color={manifest.color}
                name={manifest.name}
                meta={[manifest.publisher, manifest.version, entry.dev && t('extensions.dev')]}
                description={manifest.description}
            />
            {failure !== undefined && <p className="text-sm text-status-error">{failure}</p>}
            <SettingsSection>
                <SettingsRow
                    label={t('extensions.enabled')}
                    control={
                        <Switch
                            checked={entry.enabled}
                            disabled={entry.dev}
                            label={t('extensions.enabled')}
                            onCheckedChange={(next) => void setExtensionEnabled(id, next)}
                        />
                    }
                />
                {!entry.dev && (
                    <SettingsRow
                        label={t('extensions.remove')}
                        description={t('extensions.removeDescription')}
                        control={
                            <Button
                                onClick={() => {
                                    void removeExtension(id).then(onRemoved);
                                }}
                            >
                                {t('extensions.remove')}
                            </Button>
                        }
                    />
                )}
            </SettingsSection>
            <PermissionsSection permissions={manifest.permissions} />
            {settings !== undefined && entry.enabled && createElement(settings.component)}
        </div>
    );
}

function InstalledGroup({
    title,
    entries,
    selected,
    onSelect
}: {
    title: string;
    entries: readonly InstalledClientExtension[];
    selected: string;
    onSelect: (id: string) => void;
}) {
    if (entries.length === 0) {
        return null;
    }

    return (
        <>
            <SectionLabel className="px-3 pt-3 pb-1">{title}</SectionLabel>
            {entries.map((entry) => (
                <MasterItem key={entry.manifest.id} selected={selected === entry.manifest.id} onSelect={() => onSelect(entry.manifest.id)}>
                    <ExtensionTile icon={extensionIconUrl(entry)} color={entry.manifest.color} size={LIST_ROW_TILE} />
                    {entry.manifest.name}
                </MasterItem>
            ))}
        </>
    );
}

/* Settings, Extensions: the store and what is installed on the left, and on the right one extension or the store. */
export function ExtensionsPane() {
    const { t } = useTranslation('settings');
    const installed = useInstalledExtensions((state) => state.installed);
    const builtIns = useContributions((state) => state.builtIns);
    const [selected, setSelected] = useState(BROWSE);
    const developing = installed.filter((entry) => entry.dev);
    const fromStore = installed.filter((entry) => !entry.dev);

    useEffect(() => {
        void syncExtensions();
    }, []);

    if (desktop()?.extensions === undefined) {
        return <p className="text-sm text-text-muted">{t('extensions.desktopOnly')}</p>;
    }

    return (
        <MasterDetail
            listWidth={280}
            listLabel={t('extensions.list')}
            list={
                <>
                    <MasterItem selected={selected === BROWSE} onSelect={() => setSelected(BROWSE)}>
                        <span className="inline-flex shrink-0 items-center justify-center" style={{ width: LIST_ROW_TILE }}>
                            <Icon icon={Store} size={16} />
                        </span>
                        {t('extensions.browse')}
                    </MasterItem>
                    <Separator orientation="horizontal" className="my-1.5" />
                    <InstalledGroup title={t('extensions.groupDevelopment')} entries={developing} selected={selected} onSelect={setSelected} />
                    <InstalledGroup title={t('extensions.groupInstalled')} entries={fromStore} selected={selected} onSelect={setSelected} />
                    {builtIns.length > 0 && <SectionLabel className="px-3 pt-3 pb-1">{t('extensions.groupIncluded')}</SectionLabel>}
                    {builtIns.map((entry) => (
                        <MasterItem key={entry.id} selected={selected === entry.id} onSelect={() => setSelected(entry.id)}>
                            <ExtensionTile icon={entry.icon} color={entry.manifest.color} size={LIST_ROW_TILE} />
                            {entry.manifest.name}
                        </MasterItem>
                    ))}
                </>
            }
            detail={
                <>
                    {extensionsInSafeMode() && <p className="text-sm text-text-muted">{t('extensions.safeMode')}</p>}
                    {selected === BROWSE ? (
                        <StoreDetail onShown={setSelected} />
                    ) : builtIns.some((entry) => entry.id === selected) ? (
                        <BuiltInDetail id={selected} />
                    ) : (
                        <InstalledDetail id={selected} onRemoved={() => setSelected(BROWSE)} />
                    )}
                </>
            }
        />
    );
}
