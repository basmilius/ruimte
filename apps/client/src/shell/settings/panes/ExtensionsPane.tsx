import { createElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';
import { Button, Icon, Switch } from '@adecore/ui';
import { MasterDetail, MasterItem, SettingsRow } from '@adecore/ui/settings';
import { desktop } from '@/desktop/bridge';
import { extensionsInSafeMode, syncExtensions, useInstalledExtensions } from '@/extensions/loader';
import { readDisabled } from '@/extensions/internal';
import { useContributions } from '@/extensions/registry';
import { installFromStore, readStore, removeExtension, setExtensionEnabled, type ExtensionStoreEntry, type StoreAnswer } from '@/extensions/store';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useToasts } from '@/state/toasts';

const BROWSE = 'browse';

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
            <SettingsSection title={open.name}>
                <p className="text-sm text-text-muted">
                    {[open.publisher, open.version, open.reviewedAt && t('extensions.reviewed', { date: open.reviewedAt })].filter(Boolean).join(', ')}
                </p>
                {open.description !== undefined && <p className="text-sm">{open.description}</p>}
                <p className="text-sm font-medium">{t('extensions.asksTo')}</p>
                <ul className="flex flex-col gap-1 text-sm">
                    {Object.entries(open.permissions ?? {}).map(([permission, reason]) => (
                        <li key={permission} className="flex justify-between gap-3">
                            <span className="font-mono text-xs">{permission}</span>
                            <span className="text-text-muted">{reason}</span>
                        </li>
                    ))}
                </ul>
                <p className="rounded-md bg-surface-sunken p-2 text-sm">{t('extensions.trust')}</p>
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
            </SettingsSection>
        );
    }

    const shown = answer.entries.filter((entry) =>
        `${entry.name} ${entry.description ?? ''} ${entry.category ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
    );

    return (
        <SettingsSection title={t('extensions.store')}>
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
                            className="w-full rounded-lg border border-border p-2 text-left hover:bg-surface-hover"
                            onClick={() => setOpen(entry)}
                        >
                            <span className="block text-sm font-medium">{entry.name}</span>
                            <span className="block text-xs text-text-muted">{entry.publisher ?? entry.id}</span>
                            {entry.description !== undefined && <span className="mt-1 block text-sm text-text-muted">{entry.description}</span>}
                        </button>
                    </li>
                ))}
            </ul>
        </SettingsSection>
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
        <SettingsSection title={entry.manifest.name}>
            <p className="text-sm text-text-muted">{[entry.manifest.publisher, t('extensions.included')].filter(Boolean).join(', ')}</p>
            {entry.manifest.description !== undefined && <p className="text-sm">{entry.manifest.description}</p>}
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
        <>
            {/* Ruimte's own: an extension draws only below this, so it cannot hide the way out. */}
            <SettingsSection title={manifest.name}>
                <p className="text-sm text-text-muted">{[manifest.publisher, manifest.version, entry.dev && t('extensions.dev')].filter(Boolean).join(', ')}</p>
                {failure !== undefined && <p className="text-sm text-status-error">{failure}</p>}
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
                {Object.entries(manifest.permissions ?? {}).map(([permission, reason]) => (
                    <SettingsRow key={permission} label={reason} description={permission} control={null} />
                ))}
                {!entry.dev && (
                    <div>
                        <Button
                            onClick={() => {
                                void removeExtension(id).then(onRemoved);
                            }}
                        >
                            {t('extensions.remove')}
                        </Button>
                    </div>
                )}
            </SettingsSection>
            {settings !== undefined && entry.enabled && createElement(settings.component)}
        </>
    );
}

/* Settings, Extensions: the store and what is installed on the left, and on the right one extension or the store. */
export function ExtensionsPane() {
    const { t } = useTranslation('settings');
    const installed = useInstalledExtensions((state) => state.installed);
    const builtIns = useContributions((state) => state.builtIns);
    const [selected, setSelected] = useState(BROWSE);

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
                        <Icon icon={Store} size={14} /> {t('extensions.browse')}
                    </MasterItem>
                    {builtIns.map((entry) => (
                        <MasterItem key={entry.id} selected={selected === entry.id} onSelect={() => setSelected(entry.id)}>
                            {entry.manifest.name}
                        </MasterItem>
                    ))}
                    {installed.map((entry) => (
                        <MasterItem key={entry.manifest.id} selected={selected === entry.manifest.id} onSelect={() => setSelected(entry.manifest.id)}>
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
