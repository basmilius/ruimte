import { Button, Icon, IconButton, Input, Keys, ShortcutInput, formatShortcut, type Shortcut } from '@adecore/ui';
import { ConfirmDialog, MasterDetail, MasterItem, SettingsRow } from '@adecore/ui/settings';
import { RotateCcw, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isApplePlatform, isDesktop } from '@/desktop/bridge';
import { useContributions } from '@/extensions/registry';
import { keyboardGroups } from '@/shell/settings/keyboard-groups';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { extensionUsesKey, refusalOf } from '@/shell/settings/shortcut-refusal';
import { filterShortcuts, shortcutGroupOf, shortcutRowId, type ShortcutGroup, type ShortcutRow } from '@/shell/settings/shortcuts';
import { isRebound, keyOf, rebind, removeOverride, removeOverrideOf, setShortcutRecording, useOverrides } from '@/shell/shortcut-overrides';
import { useUi } from '@/state/ui';

interface Rebinding {
    /* Every row of the pane, which the holder of a key is looked up in. */
    groups: readonly ShortcutGroup[];
    apple: boolean;
}

/* The keys as the rows show them, or the recorder of a row a person may rebind, with a way back to the default. */
function RowControl({ row, groups, apple }: { row: ShortcutRow } & Rebinding) {
    const { t } = useTranslation('settings');
    const snapshot = useOverrides();

    if (row.id === undefined) {
        return <Keys shortcut={row.keys} then={row.then} />;
    }

    const id = row.id;
    const refusal = (next: Shortcut): string | null => {
        const found = refusalOf(next, id, groups, { apple, browserTab: !isDesktop() });

        if (found === null) {
            return null;
        }

        return found.reason === 'modifier'
            ? t(apple ? 'keyboard.needsModifierApple' : 'keyboard.needsModifier')
            : found.reason === 'browser'
              ? t('keyboard.browserKeeps')
              : t('keyboard.taken', { name: found.label });
    };

    return (
        <span className="flex items-center gap-1">
            {isRebound(snapshot, id) && (
                <IconButton icon={RotateCcw} size="sm" label={t('keyboard.reset', { name: row.label })} onClick={() => removeOverride(id)} />
            )}
            <ShortcutInput
                value={row.keys}
                size="sm"
                label={t('keyboard.shortcutFor', { name: row.label })}
                labels={{ prompt: t('keyboard.recordPrompt'), unsupported: t('keyboard.recordUnsupported') }}
                validate={refusal}
                onChange={(next) => rebind(id, next)}
                onRecordingChange={setShortcutRecording}
            />
        </span>
    );
}

function GroupCard({ group, footer, groups, apple }: { group: ShortcutGroup; footer?: ReactNode } & Rebinding) {
    const { t } = useTranslation('settings');
    const slotEntries = useContributions((state) => state.slotEntries);
    const extensionKeys = slotEntries.flatMap((entry) => (entry.shortcut === undefined ? [] : [entry.shortcut]));

    return (
        <SettingsSection title={group.title} footer={footer}>
            {group.shortcuts.map((shortcut, index) => (
                <SettingsRow
                    key={`${shortcut.label}-${index}`}
                    searchId={shortcutRowId(group.id, index)}
                    label={shortcut.label}
                    description={shortcut.id !== undefined && extensionUsesKey(extensionKeys, shortcut.keys, apple) ? t('keyboard.extensionUses') : undefined}
                    control={<RowControl row={shortcut} groups={groups} apple={apple} />}
                />
            ))}
        </SettingsSection>
    );
}

/* The shortcut categories beside the shortcuts of the one picked; a search looks through every category at once. */
export function KeyboardPane() {
    const { t } = useTranslation('settings');
    const target = useUi((s) => s.settings.target);
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState<string | null>(() => (target === null ? null : shortcutGroupOf(target)));
    const [restoring, setRestoring] = useState(false);
    const apple = isApplePlatform();
    const snapshot = useOverrides();
    // The command list depends on canvas state (layouts, locks) the compiler cannot see, so it is read once per pane visit and again when a key is rebound.
    const groups = keyboardGroups(apple, snapshot).filter((group) => group.shortcuts.length > 0);
    const rebindable = groups.flatMap((group) => group.shortcuts.flatMap((row) => (row.id === undefined ? [] : [row.id])));
    const changed = rebindable.some((id) => isRebound(snapshot, id));
    const searching = query.trim() !== '';
    const visible = filterShortcuts(groups, query, apple);
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
              newView: formatShortcut(keyOf('view-new'), apple),
              closeCell: formatShortcut(keyOf('close-cell'), apple)
          });

    const countOf = (group: ShortcutGroup): number =>
        searching ? (visible.find((entry) => entry.id === group.id)?.shortcuts.length ?? 0) : group.shortcuts.length;

    const list = (
        <>
            <div className="relative mb-1.5 shrink-0">
                <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" aria-hidden />
                <Input
                    className="px-8 text-xs"
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
                    <IconButton
                        icon={X}
                        size="sm"
                        label={t('keyboard.clearSearch')}
                        tooltip={false}
                        className="absolute top-1/2 right-1 -translate-y-1/2"
                        onClick={() => setQuery('')}
                    />
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
            <Button variant="secondary" size="sm" className="mt-1.5 shrink-0 self-start" disabled={!changed} onClick={() => setRestoring(true)}>
                {t('keyboard.restoreDefaults')}
            </Button>
            <ConfirmDialog
                open={restoring}
                onOpenChange={setRestoring}
                title={t('keyboard.restoreTitle')}
                description={t('keyboard.restoreDescription')}
                confirmLabel={t('keyboard.restoreConfirm')}
                onConfirm={async () => removeOverrideOf(rebindable)}
            />
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
                    visible.map((group, index) => (
                        <GroupCard key={group.id} group={group} groups={groups} apple={apple} footer={index === visible.length - 1 ? note : undefined} />
                    ))
                ) : (
                    current && <GroupCard group={current} groups={groups} apple={apple} footer={note} />
                )
            }
        />
    );
}
