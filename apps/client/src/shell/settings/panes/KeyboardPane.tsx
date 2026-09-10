import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { appCommands } from '@/shell/commands';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Keys } from '@/shell/settings/controls';
import { CANVAS_SHORTCUTS, commandShortcuts, filterShortcuts } from '@/shell/settings/shortcuts';
import { Icon } from '@/ui/Icon';

export function KeyboardPane() {
    const [query, setQuery] = useState('');
    // The command list depends on canvas state (layouts, locks), so it is read once per pane visit.
    const groups = useMemo(() => [commandShortcuts(appCommands()), ...CANVAS_SHORTCUTS], []);
    const visible = useMemo(() => filterShortcuts(groups, query), [groups, query]);

    return (
        <>
            <div className="relative">
                <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint" aria-hidden />
                <input
                    className="field px-9"
                    placeholder="Search shortcuts"
                    aria-label="Search shortcuts"
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
                    <button className="icon-btn absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2" aria-label="Clear search" onClick={() => setQuery('')}>
                        <Icon icon={X} size={16} />
                    </button>
                )}
            </div>
            {visible.length === 0 && <p className="text-xs text-text-muted">Nothing matches "{query.trim()}".</p>}
            {visible.map((group) => (
                <SettingsSection key={group.title} title={group.title}>
                    {group.shortcuts.map((shortcut, index) => (
                        <SettingsRow key={`${shortcut.keys}-${index}`} label={shortcut.label} control={<Keys keys={shortcut.keys} />} />
                    ))}
                </SettingsSection>
            ))}
            <p className="text-xs text-text-faint">On Windows and Linux, ⌘ is Ctrl and ⌥ is Alt.</p>
        </>
    );
}
