import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { isApplePlatform, isDesktop } from '@/desktop/bridge';
import { appCommands } from '@/shell/commands';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Keys } from '@/ui/Kbd';
import { commandShortcuts, filterShortcuts, shortcutGroups } from '@/shell/settings/shortcuts';
import { Icon } from '@/ui/Icon';
import { formatShortcut } from '@/ui/shortcut';

export function KeyboardPane() {
    const { t, i18n } = useTranslation('settings');
    const [query, setQuery] = useState('');
    const apple = isApplePlatform();
    // The command list depends on canvas state (layouts, locks), so it is read once per pane visit.
    // The language is a dependency the linter cannot see. Both lists read their words off i18next.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    const groups = useMemo(() => [commandShortcuts(appCommands()), ...shortcutGroups(apple)], [apple, i18n.language]);
    const visible = useMemo(() => filterShortcuts(groups, query, apple), [groups, query, apple]);

    return (
        <>
            <div className="relative">
                <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint" aria-hidden />
                <input
                    className="field px-9"
                    placeholder={t('keyboard.search')}
                    aria-label={t('keyboard.search')}
                    value={query}
                    spellCheck={false}
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
                        className="icon-btn absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
                        aria-label={t('keyboard.clearSearch')}
                        onClick={() => setQuery('')}
                    >
                        <Icon icon={X} size={16} />
                    </button>
                )}
            </div>
            {visible.length === 0 && <p className="text-xs text-text-muted">{t('keyboard.noMatch', { query: query.trim() })}</p>}
            {visible.map((group) => (
                <SettingsSection key={group.title} title={group.title}>
                    {group.shortcuts.map((shortcut, index) => (
                        <SettingsRow
                            key={`${shortcut.label}-${index}`}
                            label={shortcut.label}
                            control={<Keys shortcut={shortcut.keys} then={shortcut.then} />}
                        />
                    ))}
                </SettingsSection>
            ))}
            {/* A page in a browser tab never sees the tab shortcuts; the browser takes them first. */}
            {!isDesktop() && (
                <p className="text-xs text-text-faint">
                    {t('keyboard.browserNote', {
                        newView: formatShortcut(CANVAS_SHORTCUTS.newView, apple),
                        closeCell: formatShortcut(CANVAS_SHORTCUTS.closeCell, apple)
                    })}
                </p>
            )}
        </>
    );
}
