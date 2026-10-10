import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import {
    ALargeSmall,
    CaseSensitive,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    CornerDownLeft,
    ListChecks,
    Regex,
    Search,
    TextSelect,
    WholeWord,
    X,
    type LucideIcon
} from 'lucide-react';
import { isApplePlatform } from '@/desktop/bridge';
import { requiredShortcut } from '@/shell/editor-keymap';
import type { FindOptions } from '@/find/query';
import { FIND_SHORTCUTS } from '@/find/shortcuts';
import type { FindState } from '@/find/use-find';
import { formatNumber } from '@adecore/ui/format';
import { Button, ButtonGroup, Icon, IconButton, Surface, matchesShortcut, type Shortcut, Tooltip } from '@adecore/ui';

const OPTIONS: readonly { key: keyof FindOptions; icon: LucideIcon; label: string }[] = [
    { key: 'caseSensitive', icon: CaseSensitive, label: 'find.caseSensitive' },
    { key: 'wholeWord', icon: WholeWord, label: 'find.wholeWord' },
    { key: 'regex', icon: Regex, label: 'find.regex' }
];

/* What a surface that can replace hands the bar: what to do, and why it cannot while it cannot. */
export interface FindReplacement {
    onReplace(): void;
    onReplaceAll(): void;
    /* Why this surface cannot be written to right now, such as a file that is read only. */
    disabledReason?: string | null;
}

export interface FindBarProps {
    find: FindState;
    total: number;
    /* Zero-based; null while nothing is picked. */
    current: number | null;
    invalid?: boolean;
    onStep(direction: 1 | -1): void;
    /* Why a toggle does nothing on this surface, per toggle; a toggle without one works. */
    unsupported?: Partial<Record<keyof FindOptions, string>>;
    /* Why this surface cannot be searched at all; the bar still opens, to say so. */
    disabledReason?: string | null;
    /* Gives the bar a replace row, behind the arrow at its left. */
    replacement?: FindReplacement;
    /* Lets a search be held to the selection, and says when that was asked with nothing selected. */
    selectionScope?: { noSelection: boolean };
    /* Puts a caret on every match and closes the bar. */
    onSelectAll?: () => void;
    className?: string;
}

/*
 * The one find bar, a panel at the top right of the surface it searches: the field with its three
 * toggles, how many it found and the way through them, and under it, where the surface can replace,
 * what to write in place. What a match is and where it is drawn is the surface's.
 */
export function FindBar({
    find,
    total,
    current,
    invalid = false,
    onStep,
    unsupported = {},
    disabledReason = null,
    replacement,
    selectionScope,
    onSelectAll,
    className
}: FindBarProps) {
    const { t } = useTranslation('common');
    const input = useRef<HTMLInputElement>(null);
    const { query, setQuery, summons } = find;
    const disabled = disabledReason !== null;
    const replacing = replacement !== undefined && find.replaceOpen;
    const cannotReplace = disabled || total === 0 || (replacement?.disabledReason ?? null) !== null;

    useLayoutEffect(() => {
        input.current?.focus();
        input.current?.select();
    }, [summons]);

    /* The bar's own keys, and the platform's find next, find previous and select all occurrences, which do the same from the field. */
    const keys = (event: ReactKeyboardEvent<HTMLInputElement>): Shortcut | null => {
        if (event.nativeEvent.isComposing) {
            return null;
        }
        const apple = isApplePlatform();
        const platform = (id: 'findNext' | 'findPrevious' | 'selectAllOccurrences'): boolean => matchesShortcut(requiredShortcut(id), event.nativeEvent, apple);
        if (platform('findNext')) {
            return FIND_SHORTCUTS.next;
        }
        if (platform('findPrevious')) {
            return FIND_SHORTCUTS.previous;
        }
        if (platform('selectAllOccurrences')) {
            return FIND_SHORTCUTS.selectAll;
        }
        return (
            (['close', 'next', 'previous', 'selectAll'] as const)
                .map((name) => FIND_SHORTCUTS[name])
                .find((target) => matchesShortcut(target, event.nativeEvent, apple)) ?? null
        );
    };

    const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
        const key = keys(e);
        if (key === FIND_SHORTCUTS.close) {
            // The surface around the bar keeps the keyboard; Escape there would step out of it.
            e.preventDefault();
            e.stopPropagation();
            find.close();
        } else if (key === FIND_SHORTCUTS.next || key === FIND_SHORTCUTS.previous) {
            e.preventDefault();
            if (!disabled) {
                onStep(key === FIND_SHORTCUTS.previous ? -1 : 1);
            }
        } else if (key === FIND_SHORTCUTS.selectAll) {
            e.preventDefault();
            if (!disabled && total > 0) {
                onSelectAll?.();
            }
        }
    };

    /* Enter writes the replacement and moves on, and Mod+Enter writes it everywhere. */
    const onReplaceKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
        if (e.nativeEvent.isComposing) {
            return;
        }
        if (matchesShortcut(FIND_SHORTCUTS.replaceAll, e.nativeEvent, isApplePlatform())) {
            e.preventDefault();
            if (!cannotReplace) {
                replacement?.onReplaceAll();
            }
        } else if (keys(e) === FIND_SHORTCUTS.close) {
            e.preventDefault();
            e.stopPropagation();
            find.close();
        } else if (matchesShortcut(FIND_SHORTCUTS.next, e.nativeEvent, isApplePlatform())) {
            e.preventDefault();
            if (!cannotReplace) {
                replacement?.onReplace();
            }
        }
    };

    const countOf = (): ReactNode => {
        if (query.text === '' || disabled) {
            return null;
        }
        if (query.inSelection === true && selectionScope?.noSelection === true) {
            return t('find.noSelection');
        }
        if (invalid) {
            return (
                <span className="text-status-error" role="alert">
                    {t('find.invalid')}
                </span>
            );
        }
        if (total === 0) {
            return t('find.none');
        }
        return current === null ? formatNumber(total) : t('find.count', { current: formatNumber(current + 1), total: formatNumber(total) });
    };
    const count = countOf();

    const field = (
        <input
            ref={input}
            type="text"
            spellCheck={false}
            autoComplete="off"
            aria-label={t('find.label')}
            placeholder={t('find.label')}
            readOnly={disabled}
            aria-disabled={disabled}
            value={disabled ? '' : query.text}
            onChange={(e) => setQuery({ ...query, text: e.target.value })}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-faint aria-disabled:cursor-default"
        />
    );

    return (
        <Surface
            data-find-bar
            role="search"
            className={clsx('absolute top-2 right-3 z-20 flex w-[440px] max-w-[calc(100%-24px)] flex-col gap-1.5 rounded-lg p-1.5', className)}
        >
            <div className="flex items-center gap-1.5">
                {replacement !== undefined && (
                    <IconButton
                        icon={find.replaceOpen ? ChevronDown : ChevronRight}
                        size="sm"
                        label={find.replaceOpen ? t('find.replace.hide') : t('find.replace.toggle')}
                        aria-expanded={find.replaceOpen}
                        onClick={() => find.setReplaceOpen(!find.replaceOpen)}
                    />
                )}
                <div className="field field-sm flex min-w-0 grow items-center gap-1.5 pr-0.5">
                    <Icon icon={Search} size={12} className="shrink-0 text-text-faint" />
                    {disabled ? <Tooltip label={disabledReason}>{field}</Tooltip> : field}
                    <ButtonGroup>
                        {OPTIONS.map((option) => {
                            const reason = disabled ? disabledReason : (unsupported[option.key] ?? null);
                            return (
                                <IconButton
                                    key={option.key}
                                    icon={option.icon}
                                    size="xs"
                                    label={t(option.label)}
                                    tooltip={reason ?? undefined}
                                    aria-pressed={reason === null && query[option.key]}
                                    aria-disabled={reason !== null}
                                    onClick={() => {
                                        if (reason === null) {
                                            setQuery({ ...query, [option.key]: !query[option.key] });
                                        }
                                    }}
                                />
                            );
                        })}
                        {selectionScope !== undefined && (
                            <IconButton
                                icon={TextSelect}
                                size="xs"
                                label={t('find.inSelection')}
                                tooltip={disabledReason ?? undefined}
                                aria-pressed={!disabled && query.inSelection === true}
                                aria-disabled={disabled}
                                onClick={() => {
                                    if (!disabled) {
                                        setQuery({ ...query, inSelection: query.inSelection !== true });
                                    }
                                }}
                            />
                        )}
                    </ButtonGroup>
                </div>
                {count !== null && <span className="shrink-0 text-xs whitespace-nowrap text-text-muted tabular-nums">{count}</span>}
                <ButtonGroup>
                    <IconButton
                        icon={ChevronUp}
                        size="sm"
                        label={t('find.previous')}
                        kbd={FIND_SHORTCUTS.previous}
                        disabled={disabled || total === 0}
                        onClick={() => onStep(-1)}
                    />
                    <IconButton
                        icon={ChevronDown}
                        size="sm"
                        label={t('find.next')}
                        kbd={FIND_SHORTCUTS.next}
                        disabled={disabled || total === 0}
                        onClick={() => onStep(1)}
                    />
                    {onSelectAll !== undefined && (
                        <IconButton
                            icon={ListChecks}
                            size="sm"
                            label={t('find.selectAll')}
                            kbd={requiredShortcut('selectAllOccurrences')}
                            disabled={disabled || total === 0}
                            onClick={onSelectAll}
                        />
                    )}
                    <IconButton icon={X} size="sm" label={t('find.close')} kbd={FIND_SHORTCUTS.close} onClick={find.close} />
                </ButtonGroup>
            </div>
            {replacing && (
                <div className="flex items-center gap-1.5">
                    {/* The width of the arrow above, so the two fields start on the same line. */}
                    <span className="w-7 shrink-0" />
                    <div className="field field-sm flex min-w-0 grow items-center gap-1.5">
                        <Icon icon={CornerDownLeft} size={12} className="shrink-0 text-text-faint" />
                        <input
                            type="text"
                            spellCheck={false}
                            autoComplete="off"
                            aria-label={t('find.replace.label')}
                            placeholder={t('find.replace.label')}
                            value={find.replaceText}
                            onChange={(e) => find.setReplaceText(e.target.value)}
                            onKeyDown={onReplaceKeyDown}
                            className="h-full min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-faint"
                        />
                    </div>
                    <IconButton
                        icon={ALargeSmall}
                        size="sm"
                        label={t('find.replace.preserveCase')}
                        aria-pressed={find.preserveCase}
                        onClick={() => find.setPreserveCase(!find.preserveCase)}
                    />
                    <Tooltip label={replacement?.disabledReason ?? t('find.replace.one')}>
                        <Button variant="secondary" size="sm" aria-disabled={cannotReplace} onClick={() => !cannotReplace && replacement?.onReplace()}>
                            {t('find.replace.one')}
                        </Button>
                    </Tooltip>
                    <Tooltip label={replacement?.disabledReason ?? t('find.replace.allLabel')}>
                        <Button
                            variant="secondary"
                            size="sm"
                            aria-disabled={cannotReplace}
                            aria-label={t('find.replace.allLabel')}
                            onClick={() => !cannotReplace && replacement?.onReplaceAll()}
                        >
                            {t('find.replace.all')}
                        </Button>
                    </Tooltip>
                </div>
            )}
        </Surface>
    );
}
