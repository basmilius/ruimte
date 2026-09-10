import { useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { Popover } from '@base-ui-components/react/popover';
import clsx from 'clsx';
import { Bookmark, Check, ChevronDown, ChevronRight, Search, Shield, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { AgentKind, ModelInfo, ModelSelection, ProviderInfo, RuntimeMode } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { forgetStashed, useStash, type StashedPrompt } from '@/chat/stash';
import { MENU_LABEL, MENU_SEPARATOR, SECTION_LABEL } from '@/ui/classes';
import { Select, type SelectItem } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

const triggerClass =
    'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs text-text-muted hover:bg-surface-sunken hover:text-text data-[popup-open]:bg-surface-sunken data-[popup-open]:text-text';

function Popup({ children, minWidth }: { children: React.ReactNode; minWidth?: string }) {
    return (
        <Menu.Portal>
            <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={8} align="start">
                <Menu.Popup className={clsx('menu-popup', minWidth)}>{children}</Menu.Popup>
            </Menu.Positioner>
        </Menu.Portal>
    );
}

function RadioRow({ value, label, hint, badge }: { value: string; label: string; hint?: string; badge?: string }) {
    return (
        <Menu.RadioItem value={value} className={clsx('menu-item', hint && 'items-start')}>
            {/* A hint makes the row two lines high; the 20 pixel box keeps the check on the label's line. */}
            <span className="grid h-5 w-4 shrink-0 place-items-center">
                <Menu.RadioItemIndicator>
                    <Icon icon={Check} size={14} />
                </Menu.RadioItemIndicator>
            </span>
            <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                    {label}
                    {badge && <span className="rounded bg-accent-soft px-1 text-xs font-medium uppercase text-accent">{badge}</span>}
                </span>
                {hint && <span className="text-xs text-text-faint">{hint}</span>}
            </span>
        </Menu.RadioItem>
    );
}

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
    const [query, setQuery] = useState('');
    const [legacyOpen, setLegacyOpen] = useState(false);
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const owner = providers.find((entry) => entry.kind === provider);
    const current = owner?.models.find((model) => model.slug === selection.model);
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
            <Tooltip label={owner ? `${owner.name} · ${current?.name ?? selection.model}` : 'Choose model'} kbd="/model">
                <Popover.Trigger className={triggerClass}>
                    <AgentIcon kind={provider} size={12} />
                    <span className="max-w-40 truncate">{current?.name ?? selection.model}</span>
                    <Icon icon={ChevronDown} size={12} className="text-text-faint" />
                </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
                <Popover.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={8} align="start">
                    <Popover.Popup className="picker-popup" initialFocus={inputRef}>
                        <div className="flex items-center gap-2 border-b border-border px-2.5">
                            <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                            <input
                                ref={inputRef}
                                className="h-9 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                                placeholder="Search models"
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
                                    {providers.length === 0 ? 'No chat provider installed' : 'No models match'}
                                </div>
                            )}
                            {entries.map((entry, i) => {
                                if (entry.kind === 'legacy') {
                                    return (
                                        <button
                                            key="legacy"
                                            data-active={i === index}
                                            className={clsx(
                                                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs',
                                                i === index ? 'bg-surface-sunken text-text' : 'text-text-faint'
                                            )}
                                            onMouseEnter={() => setIndex(i)}
                                            onClick={() => choose(entry)}
                                        >
                                            <Icon icon={legacyOpen ? ChevronDown : ChevronRight} size={12} />
                                            Legacy models ({entry.count})
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
                                            className={clsx(
                                                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                                                i === index ? 'bg-surface-sunken text-text' : 'text-text-muted'
                                            )}
                                            onMouseEnter={() => setIndex(i)}
                                            onClick={() => choose(entry)}
                                        >
                                            <span className="grid h-4 w-4 shrink-0 place-items-center">{chosen && <Icon icon={Check} size={14} />}</span>
                                            <span className="min-w-0 truncate">{entry.model.name}</span>
                                            {entry.model.badge && (
                                                <span className="rounded bg-accent-soft px-1 text-xs font-medium uppercase text-accent">
                                                    {entry.model.badge}
                                                </span>
                                            )}
                                            <span className="grow" />
                                            {entry.model.legacy && <span className="text-xs text-text-faint">Legacy</span>}
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

/* The model's own knobs (reasoning, context window, thinking), one group per option. */
export function OptionsPicker({
    model,
    selection,
    onChange
}: {
    model: ModelInfo | undefined;
    selection: ModelSelection;
    onChange(id: string, value: string | boolean): void;
}) {
    if (!model || model.options.length === 0) {
        return null;
    }
    const summary = model.options
        .map((option) => {
            const value = selection.options[option.id];
            if (option.type === 'select') {
                return option.choices.find((choice) => choice.id === value)?.label ?? null;
            }
            return value === true ? option.label : null;
        })
        .filter((label): label is string => label !== null)
        .join(' · ');
    return (
        <Menu.Root>
            <Menu.Trigger className={triggerClass}>
                <Icon icon={SlidersHorizontal} size={12} />
                <span className="max-w-48 truncate">{summary || 'Options'}</span>
            </Menu.Trigger>
            <Popup minWidth="min-w-52">
                {model.options.map((option, index) => (
                    <div key={option.id}>
                        {index > 0 && <Menu.Separator className={MENU_SEPARATOR} />}
                        <div className={MENU_LABEL}>{option.label}</div>
                        {option.type === 'select' ? (
                            <Menu.RadioGroup
                                value={String(selection.options[option.id] ?? option.defaultChoice)}
                                onValueChange={(value: string) => onChange(option.id, value)}
                            >
                                {option.choices.map((choice) => (
                                    <RadioRow key={choice.id} value={choice.id} label={choice.label} hint={choice.description} />
                                ))}
                            </Menu.RadioGroup>
                        ) : (
                            <Menu.CheckboxItem
                                className={clsx('menu-item', option.description && 'items-start')}
                                checked={selection.options[option.id] === true}
                                onCheckedChange={(checked) => onChange(option.id, checked)}
                                closeOnClick={false}
                            >
                                {/* A hint makes the row two lines high; the 20 pixel box keeps the box on the label's line. */}
                                <span className="grid h-5 w-4 shrink-0 place-items-center">
                                    <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">
                                        <Menu.CheckboxItemIndicator>
                                            <Icon icon={Check} size={12} />
                                        </Menu.CheckboxItemIndicator>
                                    </span>
                                </span>
                                <span className="flex min-w-0 flex-col">
                                    {option.label}
                                    {option.description && <span className="text-xs text-text-faint">{option.description}</span>}
                                </span>
                            </Menu.CheckboxItem>
                        )}
                    </div>
                ))}
            </Popup>
        </Menu.Root>
    );
}

/*
 * Prompts put aside with Cmd+S. The shelf is the whole app's, not this chat's: on a canvas a
 * stashed prompt usually moves to another node, which is the reason to put it away in the first
 * place. Restoring drops the text, the mentions and the skills into this composer; the files a
 * draft held are named on the row but not kept, because their bytes never go to storage.
 */
export function StashPicker({ onRestore }: { onRestore(prompt: StashedPrompt): void }) {
    const prompts = useStash((s) => s.prompts);
    if (prompts.length === 0) {
        return null;
    }
    return (
        <Popover.Root>
            <Tooltip label="Stashed prompts" kbd="⌘S">
                <Popover.Trigger className={triggerClass}>
                    <Icon icon={Bookmark} size={12} />
                    <span className="tabular-nums">{prompts.length}</span>
                </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
                <Popover.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={8} align="start">
                    <Popover.Popup className="picker-popup w-80">
                        <div className={`${SECTION_LABEL} px-3 pt-2`}>Stashed prompts</div>
                        <div className="max-h-72 overflow-auto p-1">
                            {prompts.map((prompt) => (
                                <div key={prompt.id} className="group/stash flex items-start gap-1">
                                    <Popover.Close
                                        className="flex min-w-0 grow flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
                                        onClick={() => onRestore(prompt)}
                                    >
                                        <span className="line-clamp-2 whitespace-pre-wrap">{prompt.text || 'No text'}</span>
                                        {prompt.attachments.length > 0 && (
                                            <span className="text-text-faint">
                                                {prompt.attachments.length} {prompt.attachments.length === 1 ? 'file' : 'files'}, not kept
                                            </span>
                                        )}
                                    </Popover.Close>
                                    <Tooltip label="Delete" name>
                                        <button
                                            className="icon-btn mt-1 h-6 w-6 shrink-0 rounded opacity-0 group-hover/stash:opacity-100 focus-visible:opacity-100"
                                            onClick={() => forgetStashed(prompt.id)}
                                        >
                                            <Icon icon={Trash2} size={14} />
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

const MODE_ITEMS: SelectItem<RuntimeMode>[] = RUNTIME_MODES.map((mode) => ({
    value: mode.id,
    label: mode.label,
    description: mode.hint,
    icon: <Icon icon={Shield} size={12} />
}));

/* When the agent has to ask, from ask-for-everything to never. Full access is tinted, because it
   is the one setting where the composer should keep reminding you what it agreed to. */
export function ModePicker({ runtimeMode, onChange }: { runtimeMode: RuntimeMode; onChange(mode: RuntimeMode): void }) {
    return (
        <Select
            value={runtimeMode}
            label="Permissions"
            size="sm"
            variant="ghost"
            items={MODE_ITEMS}
            className={clsx(runtimeMode === 'full-access' && 'text-status-needs-you hover:text-status-needs-you')}
            onValueChange={onChange}
        />
    );
}
