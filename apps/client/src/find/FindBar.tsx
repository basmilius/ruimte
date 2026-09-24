import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, WholeWord, X, type LucideIcon } from 'lucide-react';
import { isApplePlatform } from '@/desktop/bridge';
import type { FindOptions } from '@/find/query';
import { FIND_SHORTCUTS } from '@/find/shortcuts';
import type { FindState } from '@/find/use-find';
import { formatNumber } from '@/format/number';
import { BTN_GROUP, FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { matchesShortcut, type Shortcut } from '@/ui/shortcut';
import { Tooltip } from '@/ui/Tooltip';

const OPTIONS: readonly { key: keyof FindOptions; icon: LucideIcon; label: string }[] = [
    { key: 'caseSensitive', icon: CaseSensitive, label: 'find.caseSensitive' },
    { key: 'wholeWord', icon: WholeWord, label: 'find.wholeWord' },
    { key: 'regex', icon: Regex, label: 'find.regex' }
];

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
    className?: string;
}

/*
 * The one find bar, at the top right of the surface it searches: the field, how many it found, the
 * three toggles, and the way through them. What a match is and where it is drawn is the surface's.
 */
export function FindBar({ find, total, current, invalid = false, onStep, unsupported = {}, disabledReason = null, className }: FindBarProps) {
    const { t } = useTranslation('common');
    const input = useRef<HTMLInputElement>(null);
    const { query, setQuery, summons } = find;
    const disabled = disabledReason !== null;

    useLayoutEffect(() => {
        input.current?.focus();
        input.current?.select();
    }, [summons]);

    const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
        if (e.nativeEvent.isComposing) {
            return;
        }
        const apple = isApplePlatform();
        const is = (target: Shortcut): boolean => matchesShortcut(target, e.nativeEvent, apple);
        if (is(FIND_SHORTCUTS.close)) {
            // The surface around the bar keeps the keyboard; Escape there would step out of it.
            e.preventDefault();
            e.stopPropagation();
            find.close();
        } else if (is(FIND_SHORTCUTS.next) || is(FIND_SHORTCUTS.previous)) {
            e.preventDefault();
            if (!disabled) {
                onStep(is(FIND_SHORTCUTS.previous) ? -1 : 1);
            }
        }
    };

    const count =
        query.text === '' || disabled ? null : invalid ? (
            <span className="text-status-error">{t('find.invalid')}</span>
        ) : total === 0 ? (
            t('find.none')
        ) : current === null ? (
            formatNumber(total)
        ) : (
            t('find.count', { current: formatNumber(current + 1), total: formatNumber(total) })
        );

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
            className="h-7 w-40 min-w-0 bg-transparent text-sm text-text outline-none placeholder:text-text-faint aria-disabled:cursor-default"
        />
    );

    return (
        <div
            data-find-bar
            role="search"
            className={clsx(FLOAT, 'absolute top-2 right-3 z-20 flex h-10 max-w-[calc(100%-24px)] items-center gap-2 rounded-lg pr-1 pl-3', className)}
        >
            <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
            {disabled ? <Tooltip label={disabledReason}>{field}</Tooltip> : field}
            {count !== null && <span className="shrink-0 text-xs whitespace-nowrap text-text-muted tabular-nums">{count}</span>}
            <div className={BTN_GROUP}>
                {OPTIONS.map((option) => {
                    const reason = disabled ? disabledReason : (unsupported[option.key] ?? null);
                    return (
                        <Tooltip key={option.key} label={reason ?? t(option.label)} name={reason === null}>
                            <button
                                type="button"
                                aria-label={reason === null ? undefined : t(option.label)}
                                aria-pressed={reason === null && query[option.key]}
                                aria-disabled={reason !== null}
                                className="icon-btn h-7 w-7 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
                                onClick={() => {
                                    if (reason === null) {
                                        setQuery({ ...query, [option.key]: !query[option.key] });
                                    }
                                }}
                            >
                                <Icon icon={option.icon} size={14} />
                            </button>
                        </Tooltip>
                    );
                })}
            </div>
            <Separator />
            <div className={BTN_GROUP}>
                <Tooltip label={t('find.previous')} kbd={FIND_SHORTCUTS.previous} name>
                    <button type="button" className="icon-btn h-7 w-7 disabled:opacity-40" disabled={disabled || total === 0} onClick={() => onStep(-1)}>
                        <Icon icon={ChevronUp} size={14} />
                    </button>
                </Tooltip>
                <Tooltip label={t('find.next')} kbd={FIND_SHORTCUTS.next} name>
                    <button type="button" className="icon-btn h-7 w-7 disabled:opacity-40" disabled={disabled || total === 0} onClick={() => onStep(1)}>
                        <Icon icon={ChevronDown} size={14} />
                    </button>
                </Tooltip>
                <Tooltip label={t('find.close')} kbd={FIND_SHORTCUTS.close} name>
                    <button type="button" className="icon-btn h-7 w-7" onClick={find.close}>
                        <Icon icon={X} size={14} />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}
