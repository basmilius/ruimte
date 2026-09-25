import { useEffect, useMemo, useRef } from 'react';
import { Tabs } from '@base-ui-components/react/tabs';
import { Search, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isApplePlatform } from '@/desktop/bridge';
import { usePulsarAccount } from '@/pulsar/account';
import { accountName } from '@/pulsar/account-name';
import { refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { Skeleton } from '@/shell/settings/controls';
import { mergeMachines } from '@/shell/settings/machine-list';
import { searchSettings, type SearchResult } from '@/shell/settings/search';
import { ABOUT_SECTION, ACCOUNT_SECTION, SETTINGS_GROUPS, groupLabel, sectionLabel, type SettingsSectionMeta } from '@/shell/settings/sections';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { formatShortcut } from '@/ui/shortcut';

const NAV_ITEM =
    'flex h-8 min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm text-text-muted hover:bg-surface-hover hover:text-text data-active:bg-surface-active data-active:text-text';

function NavTab({ section }: { section: SettingsSectionMeta }) {
    return (
        <Tabs.Tab value={section.id} className={NAV_ITEM}>
            <Icon icon={section.icon} size={16} className="shrink-0 text-text-faint" />
            <span className="truncate">{sectionLabel(section.id)}</span>
        </Tabs.Tab>
    );
}

/* Who this client is signed in as, and how many machines it knows; it opens the Account pane. */
function AccountTab() {
    const { t } = useTranslation('settings');
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const endpoints = useEndpoints((s) => s.endpoints);
    const signedIn = status === 'signed-in' && account !== null;
    const count = useMemo(
        () => mergeMachines({ endpoints, accountMachines: signedIn ? accountMachines : null, showLocal: hasLocalMachine() }).length,
        [endpoints, accountMachines, signedIn]
    );
    const name = signedIn ? accountName(account) : null;

    // The count includes the account's machines, which this client only learns by asking. The Account pane asks again whenever it opens.
    const unknown = signedIn && accountMachines === null;
    useEffect(() => {
        if (unknown) {
            void refreshAccountMachines();
        }
    }, [unknown]);

    return (
        <Tabs.Tab
            value={ACCOUNT_SECTION.id}
            className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover data-active:bg-surface-active"
        >
            {name === null ? (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-hover text-text-muted">
                    <Icon icon={User} size={16} />
                </span>
            ) : (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden>
                    {name.slice(0, 1).toUpperCase()}
                </span>
            )}
            <span className="flex min-w-0 flex-col">
                {status === 'loading' ? (
                    <Skeleton className="my-0.5 w-28" />
                ) : (
                    <span className="truncate text-xs text-text">{name ?? t('nav.account.signedOut')}</span>
                )}
                <span className="truncate text-xs text-text-muted">{t('nav.account.machines', { count })}</span>
            </span>
        </Tabs.Tab>
    );
}

/* The left column: one tab per section in its group, About and the account at the foot. Arrow keys move between them. */
export function SettingsNav() {
    const { t } = useTranslation('settings');

    return (
        <Tabs.List aria-label={t('sections.title')} activateOnFocus className="flex min-h-0 grow flex-col">
            <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto">
                {SETTINGS_GROUPS.map((group) => (
                    <div key={group.sections[0]!.id} className="flex flex-col gap-0.5">
                        {group.label !== null && <span className="px-2.5 pt-2.5 pb-1 text-xs font-medium text-text-faint">{groupLabel(group.label)}</span>}
                        {group.sections.map((section) => (
                            <NavTab key={section.id} section={section} />
                        ))}
                    </div>
                ))}
            </div>
            <div className="mt-auto flex flex-col gap-3 pt-3.5">
                <NavTab section={ABOUT_SECTION} />
                <div className="-mx-3 -mb-1 border-t border-border px-3 pt-3">
                    <AccountTab />
                </div>
            </div>
        </Tabs.List>
    );
}

interface SettingsSearchProps {
    query: string;
    onQuery(query: string): void;
    onPick(result: SearchResult): void;
}

/* The field above the navigation. Mod+F lands here while the dialog is up (`app-shortcuts.ts`). */
export function SettingsSearch({ query, onQuery, onPick }: SettingsSearchProps) {
    const { t } = useTranslation('settings');
    const searchAt = useUi((s) => s.settings.searchAt);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (searchAt > 0) {
            input.current?.focus();
            input.current?.select();
        }
    }, [searchAt]);

    return (
        <div className="relative shrink-0">
            <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" />
            <input
                ref={input}
                className="field bg-surface-sunken pr-12 pl-8 text-xs"
                placeholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                value={query}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => onQuery(event.target.value)}
                onKeyDown={(event) => {
                    // Escape clears the search first; the dialog only closes on an empty field.
                    if (event.key === 'Escape' && query) {
                        event.stopPropagation();
                        onQuery('');
                    }
                    if (event.key === 'Enter') {
                        const first = searchSettings(query)[0];
                        if (first) {
                            onPick(first);
                        }
                    }
                }}
            />
            {query ? (
                <button
                    type="button"
                    className="icon-btn icon-btn-sm absolute top-1/2 right-1 -translate-y-1/2"
                    aria-label={t('search.clear')}
                    onClick={() => onQuery('')}
                >
                    <Icon icon={X} size={14} />
                </button>
            ) : (
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-text-faint" aria-hidden>
                    {formatShortcut(APP_SHORTCUTS.settingsSearch, isApplePlatform())}
                </span>
            )}
        </div>
    );
}

/* In place of the navigation while a query is typed: the panes and rows that match, each a jump to where it lives. */
export function SettingsSearchResults({ query, onPick }: { query: string; onPick(result: SearchResult): void }) {
    const { t, i18n } = useTranslation('settings');
    // The language is a dependency the linter cannot see; every result reads its words off i18next.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    const results = useMemo(() => searchSettings(query), [query, i18n.language]);

    if (results.length === 0) {
        return <p className="px-2.5 py-1 text-xs break-words text-text-muted">{t('search.none', { query: query.trim() })}</p>;
    }
    return (
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto" aria-label={t('search.results')}>
            {results.map((result) => (
                <li key={`${result.section}:${result.id ?? ''}`}>
                    <button
                        type="button"
                        className="flex w-full min-w-0 flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-surface-hover"
                        onClick={() => onPick(result)}
                    >
                        <span className="truncate text-sm text-text">{result.label}</span>
                        <span className="truncate text-xs text-text-faint">{result.id === null ? t('search.pane') : sectionLabel(result.section)}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}
