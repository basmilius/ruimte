import type { ReactNode } from 'react';
import { Select as BaseSelect } from '@base-ui-components/react/select';
import i18next from 'i18next';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { MENU_LABEL } from './classes.ts';
import { Icon } from './Icon.tsx';
import { MenuCheck } from './MenuCheck.tsx';

export interface SelectItem<T extends string> {
    value: T;
    label: string;
    /* A second line under the label, for what the choice does. */
    description?: string;
    icon?: ReactNode;
    disabled?: boolean;
}

export interface SelectGroup<T extends string> {
    label: string;
    items: SelectItem<T>[];
}

interface SelectProps<T extends string> {
    value: T | null;
    onValueChange(value: T): void;
    items: SelectItem<T>[] | SelectGroup<T>[];
    /* The accessible name of the trigger; the row above it usually carries the visible one. */
    label: string;
    /* What the trigger shows while nothing is picked. */
    placeholder?: string;
    size?: 'sm' | 'md';
    variant?: 'outlined' | 'ghost';
    disabled?: boolean;
    align?: 'start' | 'end';
    truncateValue?: boolean;
    className?: string;
}

const isGroup = <T extends string>(entry: SelectItem<T> | SelectGroup<T>): entry is SelectGroup<T> => Array.isArray((entry as SelectGroup<T>).items);

const TRIGGER_SIZE = {
    sm: 'h-7 gap-1 px-2',
    md: 'h-8 gap-1.5 px-2'
} as const;

const TRIGGER_VARIANT = {
    outlined: 'max-w-56 rounded-lg border border-border bg-surface-raised text-text',
    ghost: 'rounded-md text-text-muted hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active data-[popup-open]:text-text data-disabled:hover:bg-transparent data-disabled:hover:text-text-muted'
} as const;

/* The dimmed look `Toggle` and `Button` wear when disabled, so a select that cannot open reads as such. */
const TRIGGER_DISABLED = 'data-disabled:cursor-default data-disabled:opacity-50';

/* A description makes the row two lines high; the box keeps the icon on the label's line. */
function Row<T extends string>({ item, picked }: { item: SelectItem<T>; picked: boolean }) {
    return (
        <BaseSelect.Item className={clsx('menu-item', item.description && 'items-start')} value={item.value} label={item.label} disabled={item.disabled}>
            <MenuCheck kind="radio" checked={picked} />
            {item.icon && <span className="flex h-lh shrink-0 items-center">{item.icon}</span>}
            <span className="flex min-w-0 flex-col">
                <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                {item.description && <span className="text-xs text-text-faint">{item.description}</span>}
            </span>
        </BaseSelect.Item>
    );
}

/* The one select in the app. A Base UI `Select` in the popup style the menus use, so a settings
   field and a picker in the composer read the same. Base UI brings the keyboard along (arrows,
   Home and End, typeahead, Enter, Escape), which a hand-rolled listbox would have to repeat. */
export function Select<T extends string>({
    value,
    onValueChange,
    items,
    label,
    placeholder = i18next.t('ui:action.select'),
    size = 'md',
    variant = 'outlined',
    disabled,
    align = 'start',
    truncateValue = true,
    className
}: SelectProps<T>) {
    const groups = items.length > 0 && isGroup(items[0]!) ? (items as SelectGroup<T>[]) : null;
    const flat = groups ? groups.flatMap((group) => group.items) : (items as SelectItem<T>[]);
    const selected = flat.find((item) => item.value === value) ?? null;

    return (
        <BaseSelect.Root
            items={flat.map((item) => ({ value: item.value, label: item.label }))}
            value={value}
            disabled={disabled}
            onValueChange={(next) => onValueChange(next as T)}
        >
            <BaseSelect.Trigger
                aria-label={label}
                className={clsx(
                    'flex shrink-0 items-center whitespace-nowrap text-xs',
                    TRIGGER_SIZE[size],
                    TRIGGER_VARIANT[variant],
                    TRIGGER_DISABLED,
                    className
                )}
            >
                {selected?.icon}
                <BaseSelect.Value className={clsx(truncateValue && 'truncate')}>{() => selected?.label ?? placeholder}</BaseSelect.Value>
                <BaseSelect.Icon className="ml-auto flex shrink-0 pl-1">
                    <Icon icon={ChevronDown} size={14} />
                </BaseSelect.Icon>
            </BaseSelect.Trigger>
            <BaseSelect.Portal>
                <BaseSelect.Positioner className="z-(--z-popup)" side="bottom" align={align} sideOffset={6} alignItemWithTrigger={false}>
                    <BaseSelect.Popup className="menu-popup">
                        <BaseSelect.List className="max-h-80 overflow-auto">
                            {groups
                                ? groups.map((group) => (
                                      <BaseSelect.Group key={group.label}>
                                          <BaseSelect.GroupLabel className={MENU_LABEL}>{group.label}</BaseSelect.GroupLabel>
                                          {group.items.map((item) => (
                                              <Row key={item.value} item={item} picked={item.value === value} />
                                          ))}
                                      </BaseSelect.Group>
                                  ))
                                : flat.map((item) => <Row key={item.value} item={item} picked={item.value === value} />)}
                        </BaseSelect.List>
                    </BaseSelect.Popup>
                </BaseSelect.Positioner>
            </BaseSelect.Portal>
        </BaseSelect.Root>
    );
}
