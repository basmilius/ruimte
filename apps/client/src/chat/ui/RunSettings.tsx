import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';
import {
    Activity,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    FilePen,
    Gauge,
    Hand,
    Shield,
    ShieldAlert,
    SlidersHorizontal,
    type LucideIcon
} from 'lucide-react';
import type { AgentKind, ChatUsage, ModelInfo, ModelOptionDescriptor, ModelSelection, ProviderInfo, RuntimeMode } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { modelName, shortModelName } from '@/agents/model-name';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { formatTokens } from '@/format/number';
import { MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const MODE_ICONS: Record<RuntimeMode, LucideIcon> = {
    supervised: Hand,
    'auto-accept-edits': FilePen,
    auto: Shield,
    'full-access': ShieldAlert
};

// More choices than this do not fit beside the label, so they go in a submenu of their own.
const INLINE_CHOICES = 3;

const CONTEXT_OPTION = 'contextWindow';
const RING_RADIUS = 5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const SUBMENU_POSITIONER = { sideOffset: 4, alignOffset: -4 } as const;

interface RunSettingsProps {
    /* Whose models may be picked: every installed chat CLI before the first message, the chat's own after it. */
    providers: ProviderInfo[];
    provider: AgentKind;
    selection: ModelSelection;
    model: ModelInfo | undefined;
    runtimeMode: RuntimeMode;
    /* Controlled, so `/model` in the composer can open the same menu a click on the pill does. */
    open: boolean;
    onOpenChange(open: boolean): void;
    onModel(provider: AgentKind, slug: string): void;
    onOption(id: string, value: string | boolean): void;
    onMode(mode: RuntimeMode): void;
    usage: ChatUsage;
    /* While a turn runs, or without a machine, compacting has to wait. */
    compactDisabled: boolean;
    onCompact(): void;
}

const optionSummary = (option: ModelOptionDescriptor, selection: ModelSelection): string | null => {
    const value = selection.options[option.id];
    if (option.type === 'select') {
        return option.choices.find((choice) => choice.id === (value ?? option.defaultChoice))?.label ?? null;
    }
    return (value ?? option.defaultValue) === true ? option.label : null;
};

const optionIcon = (option: ModelOptionDescriptor): LucideIcon =>
    option.type === 'boolean' ? Gauge : option.id === CONTEXT_OPTION ? Activity : SlidersHorizontal;

const contextFraction = (usage: ChatUsage): number => (usage.contextWindow ? Math.min(1, usage.contextTokens / usage.contextWindow) : 0);

const contextTone = (fraction: number): string => (fraction >= 0.9 ? 'text-status-error' : fraction >= 0.7 ? 'text-status-needs-you' : 'text-text');

// A radio group holds one string, so a model is named by its provider and its slug together.
const modelValue = (provider: AgentKind, slug: string): string => `${provider}/${slug}`;

/*
 * Everything that decides how the next turn runs, behind one pill: the model, its own knobs and the
 * permission mode. The pill reads back all of it, so nothing has to be opened to know what is set.
 */
export function RunSettings({
    providers,
    provider,
    selection,
    model,
    runtimeMode,
    open,
    onOpenChange,
    onModel,
    onOption,
    onMode,
    usage,
    compactDisabled,
    onCompact
}: RunSettingsProps) {
    const { t } = useTranslation('chat');
    const owner = providers.find((entry) => entry.kind === provider);
    const current = modelName(selection.model, owner?.models);
    const short = shortModelName(current, owner?.models);
    const options = model?.options ?? [];
    const summary = options.flatMap((option) => {
        const label = optionSummary(option, selection);
        return label === null ? [] : [{ id: option.id, label, ring: option.id === CONTEXT_OPTION }];
    });
    // A CLI without a context choice still fills one, so the ring stands on its own next to the size.
    const standaloneContext = !options.some((option) => option.id === CONTEXT_OPTION) && Boolean(usage.contextWindow);
    if (standaloneContext) {
        summary.push({ id: CONTEXT_OPTION, label: formatTokens(usage.contextWindow ?? 0), ring: true });
    }
    const grouped = providers.length > 1;
    const live = providers.map((entry) => ({ entry, models: entry.models.filter((row) => !row.legacy) })).filter((group) => group.models.length > 0);
    const legacy = providers.map((entry) => ({ entry, models: entry.models.filter((row) => row.legacy) })).filter((group) => group.models.length > 0);
    const chosenLegacy = owner?.models.find((row) => row.legacy && row.slug === selection.model);
    const chosenModel = modelValue(provider, selection.model);
    const fullAccess = runtimeMode === 'full-access';
    const contextUsage = <ContextUsage usage={usage} disabled={compactDisabled} onCompact={onCompact} />;

    const chooseModel = (value: string): void => {
        const slash = value.indexOf('/');
        onModel(value.slice(0, slash) as AgentKind, value.slice(slash + 1));
    };

    const modelGroups = (groups: typeof live) =>
        groups.map(({ entry, models }) => (
            <Menu.Group key={entry.kind}>
                {grouped && (
                    <Menu.GroupLabel className={`${MENU_LABEL} flex items-center gap-1.5`}>
                        <AgentIcon kind={entry.kind} size={12} />
                        {entry.name}
                    </Menu.GroupLabel>
                )}
                {models.map((row) => (
                    <Menu.RadioItem key={row.slug} value={modelValue(entry.kind, row.slug)} closeOnClick className="menu-item">
                        <AgentIcon kind={entry.kind} size={14} className="shrink-0" />
                        <span className="min-w-0 truncate">{row.name}</span>
                        {row.badge && <span className="rounded bg-accent-soft px-1 text-xs font-medium text-accent">{row.badge}</span>}
                        <Menu.RadioItemIndicator className="ml-auto flex">
                            <Icon icon={Check} size={14} className="text-accent" />
                        </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                ))}
            </Menu.Group>
        ));

    return (
        <Menu.Root open={open} onOpenChange={onOpenChange}>
            <Tooltip label={t('pickers.settings.title')} kbd="/model">
                {/* Styled from `open`: the tooltip puts `data-popup-open` on the same trigger. */}
                <Menu.Trigger
                    className={clsx(
                        'flex h-8 min-w-0 items-center gap-2 rounded-full border pr-3 pl-2.5 text-xs whitespace-nowrap text-text-muted @max-xl/composer:gap-1.5 @max-sm/composer:pr-2.5',
                        open ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-hover'
                    )}
                >
                    <AgentIcon kind={provider} size={14} className="shrink-0" />
                    {/* The composer's width decides how much is said: words give way first, then whole parts. */}
                    <span className="flex min-w-0 items-center gap-2 overflow-hidden @max-xl/composer:gap-1.5">
                        <span className="truncate font-medium text-text @max-xl/composer:hidden">{current}</span>
                        <span className="hidden truncate font-medium text-text @max-xl/composer:inline">{short}</span>
                        {summary.map((entry) => (
                            <span
                                key={entry.id}
                                className={clsx('flex shrink-0 items-center gap-2 @max-xl/composer:gap-1.5', !entry.ring && '@max-md/composer:hidden')}
                            >
                                <span className="text-text-faint">·</span>
                                {entry.ring && <ContextRing usage={usage} />}
                                <span className={clsx(entry.ring && '@max-sm/composer:hidden')}>{entry.label}</span>
                            </span>
                        ))}
                        <span className="shrink-0 text-text-faint">·</span>
                        <span className={clsx('flex shrink-0 items-center gap-1', fullAccess && 'text-status-needs-you')}>
                            <Icon icon={MODE_ICONS[runtimeMode]} size={12} className="shrink-0" />
                            <span className="@max-xl/composer:hidden">{t(`modes.${runtimeMode}.short`)}</span>
                        </span>
                    </span>
                    <Icon icon={open ? ChevronUp : ChevronDown} size={12} className="shrink-0 @max-sm/composer:hidden" />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={8} align="start">
                    <Menu.Popup className="menu-popup w-80">
                        {providers.length === 0 && <div className="px-2.5 py-3 text-xs text-text-faint">{t('pickers.model.noProvider')}</div>}
                        <Menu.RadioGroup value={chosenModel} onValueChange={chooseModel}>
                            {modelGroups(live)}
                        </Menu.RadioGroup>
                        {legacy.length > 0 && (
                            <Menu.SubmenuRoot>
                                <Menu.SubmenuTrigger className="menu-item text-text-muted">
                                    <span className="min-w-0 grow truncate">
                                        {t('pickers.model.legacyGroup', { count: legacy.reduce((count, group) => count + group.models.length, 0) })}
                                    </span>
                                    {chosenLegacy && <span className={`${MENU_HINT} truncate`}>{chosenLegacy.name}</span>}
                                    <Icon icon={ChevronRight} size={14} className="shrink-0 text-text-faint" />
                                </Menu.SubmenuTrigger>
                                <Menu.Portal>
                                    <Menu.Positioner className="z-(--z-popup)" {...SUBMENU_POSITIONER}>
                                        <Menu.Popup className="menu-popup min-w-56">
                                            <Menu.RadioGroup value={chosenModel} onValueChange={chooseModel}>
                                                {modelGroups(legacy)}
                                            </Menu.RadioGroup>
                                        </Menu.Popup>
                                    </Menu.Positioner>
                                </Menu.Portal>
                            </Menu.SubmenuRoot>
                        )}
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.SubmenuRoot>
                            <Menu.SubmenuTrigger className="menu-item text-text-muted">
                                <Icon
                                    icon={MODE_ICONS[runtimeMode]}
                                    size={14}
                                    className={clsx('shrink-0', fullAccess ? 'text-status-needs-you' : 'text-text-faint')}
                                />
                                <span className="min-w-0 grow truncate">{t('pickers.mode.label')}</span>
                                <span className={`${MENU_HINT} truncate`}>{t(`modes.${runtimeMode}.label`)}</span>
                                <Icon icon={ChevronRight} size={14} className="shrink-0 text-text-faint" />
                            </Menu.SubmenuTrigger>
                            <Menu.Portal>
                                <Menu.Positioner className="z-(--z-popup)" {...SUBMENU_POSITIONER}>
                                    <Menu.Popup className="menu-popup w-72">
                                        <Menu.RadioGroup value={runtimeMode} onValueChange={(mode: RuntimeMode) => onMode(mode)}>
                                            {RUNTIME_MODES.map((mode) => (
                                                <Menu.RadioItem key={mode} value={mode} className="menu-item items-start">
                                                    {/* The hint makes the row two lines high; the boxes keep the icon and the check on the label's line. */}
                                                    <span className="grid h-5 w-4 shrink-0 place-items-center">
                                                        <Icon
                                                            icon={MODE_ICONS[mode]}
                                                            size={14}
                                                            className={mode === 'full-access' ? 'text-status-needs-you' : 'text-text-faint'}
                                                        />
                                                    </span>
                                                    <span className="flex min-w-0 grow flex-col">
                                                        {t(`modes.${mode}.label`)}
                                                        <span className="text-xs text-text-faint">{t(`modes.${mode}.hint`)}</span>
                                                    </span>
                                                    <span className="grid h-5 w-4 shrink-0 place-items-center">
                                                        <Menu.RadioItemIndicator className="flex">
                                                            <Icon icon={Check} size={14} className="text-accent" />
                                                        </Menu.RadioItemIndicator>
                                                    </span>
                                                </Menu.RadioItem>
                                            ))}
                                        </Menu.RadioGroup>
                                    </Menu.Popup>
                                </Menu.Positioner>
                            </Menu.Portal>
                        </Menu.SubmenuRoot>
                        {options.map((option) => (
                            <OptionRow key={option.id} option={option} selection={selection} onChange={(value) => onOption(option.id, value)}>
                                {option.id === CONTEXT_OPTION && contextUsage}
                            </OptionRow>
                        ))}
                        {standaloneContext && (
                            <div className="flex flex-col gap-2 px-2.5 py-1.5 text-sm text-text-muted">
                                <span className="flex items-center gap-2.5">
                                    <Icon icon={Activity} size={14} className="shrink-0 text-text-faint" />
                                    {t('contextMeter.title')}
                                </span>
                                {contextUsage}
                            </div>
                        )}
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

/* How full the context is, drawn small enough to sit in the pill beside the window's size. */
function ContextRing({ usage }: { usage: ChatUsage }) {
    const fraction = contextFraction(usage);
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" className={clsx('shrink-0', contextTone(fraction))} aria-hidden="true">
            <circle cx="7" cy="7" r={RING_RADIUS} fill="none" strokeWidth="2" className="stroke-border-strong" />
            <circle
                cx="7"
                cy="7"
                r={RING_RADIUS}
                fill="none"
                strokeWidth="2"
                stroke="currentColor"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
                transform="rotate(-90 7 7)"
            />
        </svg>
    );
}

/* The numbers behind the ring, and the one thing to do about a full context. */
function ContextUsage({ usage, disabled, onCompact }: { usage: ChatUsage; disabled: boolean; onCompact(): void }) {
    const { t } = useTranslation('chat');
    const fraction = contextFraction(usage);
    const percent = Math.round(fraction * 100);
    return (
        <>
            {usage.contextWindow ? (
                <div
                    role="meter"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('contextMeter.aria', { percent })}
                    className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
                >
                    <div className={clsx('h-full rounded-full bg-current', contextTone(fraction))} style={{ width: `${percent}%` }} />
                </div>
            ) : null}
            <div className="flex items-center gap-2 text-xs text-text-faint tabular-nums">
                <span className="min-w-0 grow truncate">
                    <span className="text-text">{formatTokens(usage.contextTokens)}</span>{' '}
                    {usage.contextWindow ? t('contextMeter.usedOf', { window: formatTokens(usage.contextWindow), percent }) : t('contextMeter.used')}
                </span>
                <Menu.Item
                    className="flex shrink-0 cursor-default items-center gap-0.5 rounded font-medium text-accent outline-none data-disabled:opacity-40 data-highlighted:underline"
                    disabled={disabled || usage.contextTokens === 0}
                    onClick={onCompact}
                >
                    {t('contextMeter.compactNow')}
                    <Icon icon={ChevronRight} size={12} />
                </Menu.Item>
            </div>
        </>
    );
}

/*
 * One of the model's own knobs: a few choices side by side, more of them in a submenu, a switch for
 * a boolean. Children go under it. Every choice is a menu item, so the arrow keys reach it.
 */
function OptionRow({
    option,
    selection,
    onChange,
    children
}: {
    option: ModelOptionDescriptor;
    selection: ModelSelection;
    onChange(value: string | boolean): void;
    children?: ReactNode;
}) {
    const icon = <Icon icon={optionIcon(option)} size={14} className="shrink-0 text-text-faint" />;
    if (option.type === 'boolean') {
        const checked = (selection.options[option.id] ?? option.defaultValue) === true;
        const item = (
            <Menu.CheckboxItem className="menu-item text-text-muted" checked={checked} onCheckedChange={onChange} closeOnClick={false}>
                {icon}
                <span className="min-w-0 grow truncate">{option.label}</span>
                <span
                    aria-hidden="true"
                    className={clsx('relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors', checked ? 'bg-accent' : 'bg-border-strong')}
                >
                    <span className={clsx('block h-4 w-4 rounded-full bg-surface-raised shadow-node transition-transform', checked && 'translate-x-4')} />
                </span>
            </Menu.CheckboxItem>
        );
        return option.description ? (
            <Tooltip label={option.description} side="right" sideOffset={12}>
                {item}
            </Tooltip>
        ) : (
            item
        );
    }
    const value = String(selection.options[option.id] ?? option.defaultChoice);
    if (option.choices.length > INLINE_CHOICES) {
        return (
            <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger className="menu-item text-text-muted">
                    {icon}
                    <span className="min-w-0 grow truncate">{option.label}</span>
                    <span className={MENU_HINT}>{option.choices.find((choice) => choice.id === value)?.label}</span>
                    <Icon icon={ChevronRight} size={14} className="shrink-0 text-text-faint" />
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" {...SUBMENU_POSITIONER}>
                        <Menu.Popup className="menu-popup min-w-56">
                            <Menu.RadioGroup value={value} onValueChange={(next: string) => onChange(next)}>
                                {option.choices.map((choice) => (
                                    <Menu.RadioItem key={choice.id} value={choice.id} className={clsx('menu-item', choice.description && 'items-start')}>
                                        <span className="flex min-w-0 grow flex-col">
                                            {choice.label}
                                            {choice.description && <span className="text-xs text-text-faint">{choice.description}</span>}
                                        </span>
                                        {/* A description makes the row two lines high; the box keeps the check on the label's line. */}
                                        <span className="grid h-5 w-4 shrink-0 place-items-center">
                                            <Menu.RadioItemIndicator className="flex">
                                                <Icon icon={Check} size={14} className="text-accent" />
                                            </Menu.RadioItemIndicator>
                                        </span>
                                    </Menu.RadioItem>
                                ))}
                            </Menu.RadioGroup>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.SubmenuRoot>
        );
    }
    return (
        <div className="flex flex-col gap-2 px-2.5 py-1.5 text-sm text-text-muted">
            <div className="flex items-center gap-2.5">
                {icon}
                <span className="min-w-0 grow truncate">{option.label}</span>
                <Menu.RadioGroup
                    value={value}
                    onValueChange={(next: string) => onChange(next)}
                    aria-label={option.label}
                    className="flex gap-0.5 rounded-md bg-surface-sunken p-0.5"
                >
                    {option.choices.map((choice) => (
                        <Menu.RadioItem
                            key={choice.id}
                            value={choice.id}
                            className={clsx(
                                'flex h-6 cursor-default items-center rounded px-2 text-xs outline-none',
                                choice.id === value ? 'bg-surface-active text-text' : 'text-text-muted data-highlighted:text-text'
                            )}
                        >
                            {choice.label}
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </div>
            {children}
        </div>
    );
}
