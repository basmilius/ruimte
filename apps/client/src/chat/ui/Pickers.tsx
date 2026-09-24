import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from '@base-ui-components/react/popover';
import { Bookmark, ChevronDown, ChevronRight, Search, Trash2 } from 'lucide-react';
import type { AgentKind, ModelInfo, ModelSelection, ProviderInfo } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { modelName } from '@/agents/model-name';
import { forgetStashed, STASH_SHORTCUT, useStash, type StashedPrompt } from '@/chat/stash';
import { MENU_LABEL } from '@/ui/classes';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { MenuCheck } from '@/ui/MenuCheck';

const triggerClass =
    'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active data-[popup-open]:text-text';

/* A model row, or the one row that folds the legacy models open. Both take a turn in the arrow keys. */
type PickerEntry = { kind: 'model'; provider: ProviderInfo; model: ModelInfo } | { kind: 'legacy'; count: number };

const matches = (model: ModelInfo, query: string): boolean => model.name.toLowerCase().includes(query) || model.slug.toLowerCase().includes(query);

interface ModelPickerProps {
    /* Whose models may be picked: every installed chat CLI before the first message, the chat's own after it. */
    providers: ProviderInfo[];
    provider: AgentKind;
    selection: ModelSelection;
    /* Controlled, so `/model` in the composer can open the same popup a click on the trigger does. */
    open: boolean;
    onOpenChange(open: boolean): void;
    onChange(provider: AgentKind, model: string): void;
}

/*
 * Which model answers: the provider's mark plus the model's short name
 * as the trigger, a search field over the popup, one group per provider and the legacy models
 * behind an expander. Before the first message the list carries every installed CLI, so picking
 * another provider's model is also how a chat picks its provider. A chat bound to one CLI passes
 * only that CLI, which drops the group headers and leaves its own catalog to choose from.
 */
export function ModelPicker({ providers, provider, selection, open, onOpenChange, onChange }: ModelPickerProps) {
    const { t } = useTranslation('chat');
    const [query, setQuery] = useState('');
    const [legacyOpen, setLegacyOpen] = useState(false);
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const owner = providers.find((entry) => entry.kind === provider);
    const current = modelName(selection.model, owner?.models);
    const grouped = providers.length > 1;
    const trimmed = query.trim().toLowerCase();

    const entries = useMemo((): PickerEntry[] => {
        const rows = providers.flatMap((entry) => entry.models.map((model) => ({ kind: 'model' as const, provider: entry, model })));
        if (trimmed !== '') {
            return rows.filter((row) => matches(row.model, trimmed));
        }
        const live = rows.filter((row) => !row.model.legacy);
        const legacy = rows.filter((row) => row.model.legacy);
        if (legacy.length === 0) {
            return live;
        }
        return legacyOpen ? [...live, { kind: 'legacy', count: legacy.length }, ...legacy] : [...live, { kind: 'legacy', count: legacy.length }];
    }, [providers, trimmed, legacyOpen]);

    /* Closing forgets the search, so the next open (a click or `/model`) starts on the whole list. */
    const setOpen = (next: boolean): void => {
        if (!next) {
            setQuery('');
            setLegacyOpen(false);
        }
        setIndex(0);
        onOpenChange(next);
    };

    // The list scrolls, so the row the arrows moved to has to come along.
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [index]);

    const choose = (entry: PickerEntry | undefined): void => {
        if (!entry) {
            return;
        }
        if (entry.kind === 'legacy') {
            setLegacyOpen(true);
            inputRef.current?.focus();
            return;
        }
        onChange(entry.provider.kind, entry.model.slug);
        setOpen(false);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => (entries.length === 0 ? 0 : (i + 1) % entries.length));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => (entries.length === 0 ? 0 : (i - 1 + entries.length) % entries.length));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(entries[index]);
        }
    };

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tooltip label={owner ? `${owner.name} · ${current}` : t('pickers.model.choose')} kbd="/model">
                <Popover.Trigger className={triggerClass}>
                    <AgentIcon kind={provider} size={12} />
                    <span className="max-w-40 truncate">{current}</span>
                    <Icon icon={ChevronDown} size={12} className="text-text-faint" />
                </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
                <Popover.Positioner className="z-(--z-popup)" side="top" sideOffset={8} align="start">
                    <Popover.Popup className="picker-popup" initialFocus={inputRef}>
                        <div className="flex items-center gap-2 border-b border-border px-2.5">
                            <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                            <input
                                ref={inputRef}
                                className="h-8 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                                placeholder={t('pickers.model.search')}
                                spellCheck={false}
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setIndex(0);
                                }}
                                onKeyDown={onKeyDown}
                            />
                        </div>
                        <div ref={listRef} className="max-h-72 overflow-auto p-1" role="listbox">
                            {entries.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">
                                    {providers.length === 0 ? t('pickers.model.noProvider') : t('pickers.model.noMatch')}
                                </div>
                            )}
                            {entries.map((entry, i) => {
                                if (entry.kind === 'legacy') {
                                    return (
                                        <button
                                            key="legacy"
                                            data-active={i === index}
                                            className="cursor-row flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-text-faint"
                                            onMouseEnter={() => setIndex(i)}
                                            onClick={() => choose(entry)}
                                        >
                                            <Icon icon={legacyOpen ? ChevronDown : ChevronRight} size={12} />
                                            {t('pickers.model.legacyGroup', { count: entry.count })}
                                        </button>
                                    );
                                }
                                const previous = entries[i - 1];
                                const first =
                                    grouped && (previous === undefined || previous.kind !== 'model' || previous.provider.kind !== entry.provider.kind);
                                const chosen = entry.provider.kind === provider && entry.model.slug === selection.model;
                                return (
                                    <div key={`${entry.provider.kind}/${entry.model.slug}`}>
                                        {first && (
                                            <div className={`${MENU_LABEL} flex items-center gap-1.5`}>
                                                <AgentIcon kind={entry.provider.kind} size={12} />
                                                {entry.provider.name}
                                            </div>
                                        )}
                                        <button
                                            role="option"
                                            aria-selected={chosen}
                                            data-active={i === index}
                                            className="cursor-row flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-text-muted"
                                            onMouseEnter={() => setIndex(i)}
                                            onClick={() => choose(entry)}
                                        >
                                            <MenuCheck kind="radio" checked={chosen} />
                                            <span className="min-w-0 truncate">{entry.model.name}</span>
                                            {entry.model.badge && (
                                                <span className="rounded bg-accent-soft px-1 text-xs font-medium text-accent">{entry.model.badge}</span>
                                            )}
                                            <span className="grow" />
                                            {entry.model.legacy && <span className="text-xs text-text-faint">{t('pickers.model.legacy')}</span>}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}

/*
 * Prompts put aside with Cmd+S. The shelf is the whole app's, not this chat's. On a canvas a
 * stashed prompt usually moves to another node, which is the reason to put it away in the first
 * place. Restoring drops the text, the mentions and the skills into this composer; the files a
 * draft held are named on the row but not kept, because their bytes never go to storage.
 */
export function StashPicker({ onRestore }: { onRestore(prompt: StashedPrompt): void }) {
    const { t } = useTranslation('chat');
    const prompts = useStash((s) => s.prompts);
    if (prompts.length === 0) {
        return null;
    }
    return (
        <Popover.Root>
            <Tooltip label={t('pickers.stash.title')} kbd={STASH_SHORTCUT}>
                <Popover.Trigger className={triggerClass}>
                    <Icon icon={Bookmark} size={12} />
                    <span className="tabular-nums">{prompts.length}</span>
                </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
                <Popover.Positioner className="z-(--z-popup)" side="top" sideOffset={8} align="start">
                    <Popover.Popup className="picker-popup w-80">
                        <div className="max-h-72 overflow-auto p-1">
                            {prompts.map((prompt) => (
                                <div key={prompt.id} className="group/stash flex items-start gap-1">
                                    <Popover.Close
                                        className="flex min-w-0 grow flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface-hover hover:text-text"
                                        onClick={() => onRestore(prompt)}
                                    >
                                        <span className="line-clamp-2 whitespace-pre-wrap">{prompt.text || t('pickers.stash.noText')}</span>
                                        {prompt.attachments.length > 0 && (
                                            <span className="text-text-faint">{t('pickers.stash.files', { count: prompt.attachments.length })}</span>
                                        )}
                                    </Popover.Close>
                                    <Tooltip label={t('common:action.delete')} name>
                                        <button
                                            className="icon-btn icon-btn-xs mt-1 opacity-0 group-hover/stash:opacity-100 focus-visible:opacity-100"
                                            onClick={() => forgetStashed(prompt.id)}
                                        >
                                            <Icon icon={Trash2} size={12} />
                                        </button>
                                    </Tooltip>
                                </div>
                            ))}
                        </div>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
