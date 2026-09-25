import { useMemo, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { isApplePlatform, isDesktop } from '@/desktop/bridge';
import { keyboardGroups } from '@/shell/settings/keyboard-groups';
import { MasterDetail, MasterItem } from '@/shell/settings/MasterDetail';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { filterShortcuts, shortcutGroupOf, shortcutRowId, type ShortcutGroup } from '@/shell/settings/shortcuts';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Keys } from '@/ui/Kbd';
import { formatShortcut } from '@/ui/shortcut';

function GroupCard({ group, footer }: { group: ShortcutGroup; footer?: ReactNode }) {
    return (
        <SettingsSection title={group.title} footer={footer}>
            {group.shortcuts.map((shortcut, index) => (
                <SettingsRow
                    key={`${shortcut.label}-${index}`}
                    searchId={shortcutRowId(group.id, index)}
                    label={shortcut.label}
                    control={<Keys shortcut={shortcut.keys} then={shortcut.then} />}
                />
            ))}
        </SettingsSection>
    );
}

/* The shortcut categories beside the shortcuts of the one picked; a search looks through every category at once. */
export function KeyboardPane() {
    const { t, i18n } = useTranslation('settings');
    const target = useUi((s) => s.settings.target);
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState<string | null>(() => (target === null ? null : shortcutGroupOf(target)));
    const apple = isApplePlatform();
    // The command list depends on canvas state (layouts, locks), so it is read once per pane visit.
    // The language is a dependency the linter cannot see. Both lists read their words off i18next.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    const groups = useMemo(() => keyboardGroups(apple).filter((group) => group.shortcuts.length > 0), [apple, i18n.language]);
    const searching = query.trim() !== '';
    const visible = useMemo(() => filterShortcuts(groups, query, apple), [groups, query, apple]);
    const current = groups.find((group) => group.id === picked) ?? groups[0] ?? null;

    // A search result leads to the category of its row, out of a search of the pane's own.
    const [seenTarget, setSeenTarget] = useState(target);
    if (target !== seenTarget) {
        setSeenTarget(target);
        const group = target === null ? null : shortcutGroupOf(target);
        if (group !== null) {
            setPicked(group);
            setQuery('');
        }
    }

    // A page in a browser tab never sees the tab shortcuts; the browser takes them first.
    const note = isDesktop()
        ? undefined
        : t('keyboard.browserNote', {
              newView: formatShortcut(CANVAS_SHORTCUTS.newView, apple),
              closeCell: formatShortcut(CANVAS_SHORTCUTS.closeCell, apple)
          });

    const countOf = (group: ShortcutGroup): number =>
        searching ? (visible.find((entry) => entry.id === group.id)?.shortcuts.length ?? 0) : group.shortcuts.length;

    const list = (
        <>
            <div className="relative mb-1.5 shrink-0">
                <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" aria-hidden />
                <input
                    className="field bg-surface-sunken px-8 text-xs"
                    placeholder={t('keyboard.search')}
                    aria-label={t('keyboard.search')}
                    value={query}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        // Escape clears the search first; the dialog only closes on an empty field.
                        if (e.key === 'Escape' && query) {
                            e.stopPropagation();
                            setQuery('');
                        }
                    }}
                />
                {query && (
                    <button
                        type="button"
                        className="icon-btn icon-btn-sm absolute top-1/2 right-1 -translate-y-1/2"
                        aria-label={t('keyboard.clearSearch')}
                        onClick={() => setQuery('')}
                    >
                        <Icon icon={X} size={14} />
                    </button>
                )}
            </div>
            {groups.map((group) => {
                const count = countOf(group);
                if (searching && count === 0) {
                    return null;
                }
                return (
                    <MasterItem
                        key={group.id}
                        selected={!searching && group.id === current?.id}
                        onSelect={() => {
                            setPicked(group.id);
                            setQuery('');
                        }}
                    >
                        <span className="min-w-0 grow truncate">{group.title}</span>
                        <span className="shrink-0 text-xs text-text-faint tabular-nums">{count}</span>
                    </MasterItem>
                );
            })}
        </>
    );

    return (
        <MasterDetail
            listWidth={280}
            listLabel={t('keyboard.categories')}
            list={list}
            detail={
                searching && visible.length === 0 ? (
                    <p className="text-xs text-text-muted">{t('keyboard.noMatch', { query: query.trim() })}</p>
                ) : searching ? (
                    visible.map((group, index) => <GroupCard key={group.id} group={group} footer={index === visible.length - 1 ? note : undefined} />)
                ) : (
                    current && <GroupCard group={current} footer={note} />
                )
            }
        />
    );
}
