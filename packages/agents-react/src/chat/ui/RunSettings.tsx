import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';
import {
    Activity,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    FilePen,
    Gauge,
    Hand,
    Settings,
    Shield,
    ShieldAlert,
    SlidersHorizontal,
    type LucideIcon
} from 'lucide-react';
import type { AgentKind, ChatUsage, ModelInfo, ModelOptionDescriptor, ModelSelection, ProviderInfo, RuntimeMode } from '@ruimte/agent-contracts';
import { AccountDot } from '../../agents/AccountDot';
import { limitsOfAccount, sessionWindow } from '../../agents/account-limits';
import { canContinueOn } from '../../agents/accounts';
import { AgentIcon } from '../../agents/AgentIcon';
import type { AccountChoice } from '../account-choice';
import { modelName, shortModelName } from '../../agents/model-name';
import { CONTEXT_OPTION, contextFraction, contextSegments, orderOptions, type ContextPart } from '../logic/context-usage';
import { RUNTIME_MODES } from '../runtime-modes';
import { formatClock, formatWeekdayClock, isSameDay } from '@ruimte/ui/format/datetime';
import { formatPercent, formatTokens } from '@ruimte/ui/format/number';
import { chatHost } from '../../host';
import { useUsageLimits } from '../../usage/limits';
import { MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';
import { MenuCheck } from '@ruimte/ui/MenuCheck';
import { Tooltip } from '@ruimte/ui/Tooltip';
import { useNow } from '@ruimte/ui/useNow';

const MINUTE_MS = 60_000;

const MODE_ICONS: Record<RuntimeMode, LucideIcon> = {
    supervised: Hand,
    'auto-accept-edits': FilePen,
    auto: Shield,
    'full-access': ShieldAlert
};

// More choices than this do not fit beside the label, so they go in a submenu of their own.
const INLINE_CHOICES = 3;

const PART_COLORS: Record<ContextPart, string> = {
    toolOutput: 'bg-chart-context-tools',
    filesRead: 'bg-chart-context-files',
    conversation: 'bg-chart-context-conversation',
    system: 'bg-chart-context-system'
};

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
    /* Null while the chat's CLI has fewer than two accounts that are on. */
    account: AccountPick | null;
}

interface AccountPick {
    choice: AccountChoice;
    /* Once the chat spoke, only an account that reads its conversation can take it over. */
    started: boolean;
    onPick(id: string): void;
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
    onCompact,
    account
}: RunSettingsProps) {
    const { t } = useTranslation('agent-chat');
    const owner = providers.find((entry) => entry.kind === provider);
    const current = modelName(selection.model, owner?.models);
    const short = shortModelName(current, owner?.models);
    const options = orderOptions(model?.options ?? []);
    const summary = options.flatMap((option) => {
        const label = optionSummary(option, selection);
        return label === null ? [] : [{ id: option.id, label, ring: option.id === CONTEXT_OPTION }];
    });
    // A CLI without a context choice still fills one, so the ring stands on its own next to the size.
    const hasContextOption = options.some((option) => option.id === CONTEXT_OPTION);
    const standaloneContext = !hasContextOption && Boolean(usage.contextWindow);
    if (standaloneContext) {
        summary.push({ id: CONTEXT_OPTION, label: formatTokens(usage.contextWindow ?? 0), ring: true });
    }
    const grouped = providers.length > 1;
    const live = providers.map((entry) => ({ entry, models: entry.models.filter((row) => !row.legacy) })).filter((group) => group.models.length > 0);
    const legacy = providers.map((entry) => ({ entry, models: entry.models.filter((row) => row.legacy) })).filter((group) => group.models.length > 0);
    const chosenLegacy = owner?.models.find((row) => row.legacy && row.slug === selection.model);
    const chosenModel = modelValue(provider, selection.model);
    const fullAccess = runtimeMode === 'full-access';

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
                        <MenuCheck kind="radio" />
                        <AgentIcon kind={entry.kind} size={14} className="shrink-0" />
                        <span className="min-w-0 truncate">{row.name}</span>
                        {row.badge && <span className="rounded bg-accent-soft px-1 text-xs font-medium text-accent">{row.badge}</span>}
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
                        {account !== null && (
                            <span className="flex min-w-0 items-center gap-2 @max-xl/composer:gap-1.5">
                                <span className="shrink-0 text-text-faint">·</span>
                                <AccountDot color={account.choice.current?.account.color} />
                                {/* The name goes before anything else does; the dot says which account on its own. */}
                                <span className="truncate @max-xl/composer:hidden">
                                    {account.choice.current === null ? account.choice.currentId : account.choice.nameOf(account.choice.current)}
                                </span>
                            </span>
                        )}
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
                        {account !== null && <AccountSubmenu provider={provider} account={account} />}
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
                                                    <MenuCheck kind="radio" />
                                                    {/* The hint makes the row two lines high; the box keeps the icon on the label's line. */}
                                                    <span className="grid h-lh w-4 shrink-0 place-items-center">
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
                                                </Menu.RadioItem>
                                            ))}
                                        </Menu.RadioGroup>
                                    </Menu.Popup>
                                </Menu.Positioner>
                            </Menu.Portal>
                        </Menu.SubmenuRoot>
                        {options.map((option) => (
                            <OptionRow key={option.id} option={option} selection={selection} onChange={(value) => onOption(option.id, value)} />
                        ))}
                        {(hasContextOption || standaloneContext) && (
                            <>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <ContextUsage usage={usage} disabled={compactDisabled} onCompact={onCompact} />
                            </>
                        )}
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

/* Red where a window is nearly spent, amber where it is worth knowing, as the usage bars have it. */
const sessionTone = (used: number): { bar: string; text: string } =>
    used >= 0.9
        ? { bar: 'bg-status-error', text: 'text-status-error' }
        : used >= 0.7
          ? { bar: 'bg-status-needs-you', text: 'text-status-needs-you' }
          : { bar: 'bg-text-muted', text: 'text-text-muted' };

/*
 * The account the next turn runs under, for the chat's own CLI. Before the first turn any of them;
 * after it one that reads the conversation, since the others would start it over, and a fork is how
 * the conversation goes along to those. A switch applies from the next turn.
 */
function AccountSubmenu({ provider, account }: { provider: AgentKind; account: AccountPick }) {
    const { t } = useTranslation('agent-chat');
    const { choice, started, onPick } = account;
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className="menu-item text-text-muted">
                <span className="grid w-3.5 shrink-0 place-items-center">
                    <AccountDot color={choice.current?.account.color} />
                </span>
                <span className="min-w-0 grow truncate">{t('pickers.account.label')}</span>
                <span className={`${MENU_HINT} truncate`}>{choice.current === null ? choice.currentId : choice.nameOf(choice.current)}</span>
                <Icon icon={ChevronRight} size={14} className="shrink-0 text-text-faint" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" {...SUBMENU_POSITIONER}>
                    <Menu.Popup className="menu-popup min-w-64">
                        <Menu.Group>
                            <Menu.GroupLabel className={`${MENU_LABEL} flex items-center gap-1.5`}>
                                <AgentIcon kind={provider} size={12} />
                                {choice.providerName}
                            </Menu.GroupLabel>
                            <Menu.RadioGroup value={choice.currentId} onValueChange={(id: string) => onPick(id)}>
                                <AccountRows choice={choice} locked={(id) => started && !canContinueOn(choice.accounts, provider, choice.currentId, id)} />
                            </Menu.RadioGroup>
                        </Menu.Group>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.Item className="menu-item text-text-muted" onClick={() => chatHost().openSettings('providers')}>
                            <Icon icon={Settings} size={14} className="shrink-0 text-text-faint" />
                            {t('pickers.account.manage')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.SubmenuRoot>
    );
}

/* Mounted only while the submenu is open, since asking for the plan windows starts a CLI per account. */
function AccountRows({ choice, locked }: { choice: AccountChoice; locked(id: string): boolean }) {
    const { t } = useTranslation('agent-chat');
    const limits = useUsageLimits();
    const now = useNow(MINUTE_MS);
    return choice.offered.map((entry) => {
        const session = sessionWindow(limitsOfAccount(limits, entry.id));
        const disabled = locked(entry.id);
        const row = (
            <Menu.RadioItem key={entry.id} value={entry.id} disabled={disabled} closeOnClick className="menu-item items-start data-disabled:opacity-50">
                <MenuCheck kind="radio" />
                <span className="flex min-w-0 grow flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                        <AccountDot color={entry.account.color} />
                        <span className="truncate">{choice.nameOf(entry)}</span>
                    </span>
                    {session !== null && <SessionLine used={session.used} resetsAt={session.resetsAt} now={now} />}
                </span>
            </Menu.RadioItem>
        );
        return disabled ? (
            <Tooltip key={entry.id} label={t('pickers.account.forkToSwitch', { account: choice.nameOf(entry) })} side="right" sideOffset={12}>
                {row}
            </Tooltip>
        ) : (
            row
        );
    });
}

function SessionLine({ used, resetsAt, now }: { used: number; resetsAt: number | null; now: number }) {
    const { t } = useTranslation('agent-chat');
    const percent = Math.round(used * 100);
    const tone = sessionTone(used);
    return (
        <span className="flex items-center gap-2 text-xs text-text-faint tabular-nums">
            <span aria-hidden className="relative h-1 w-14 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
                <span className={clsx('absolute inset-y-0 left-0 rounded-full', tone.bar)} style={{ width: `${Math.min(100, percent)}%` }} />
            </span>
            <span className={tone.text}>{formatPercent(percent)}</span>
            {resetsAt !== null && (
                <span className="whitespace-nowrap">
                    · {t('pickers.account.resets', { time: isSameDay(resetsAt, now) ? formatClock(resetsAt) : formatWeekdayClock(resetsAt) })}
                </span>
            )}
        </span>
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

/* How full the context is and what fills it, and the one thing to do about a full context. */
function ContextUsage({ usage, disabled, onCompact }: { usage: ChatUsage; disabled: boolean; onCompact(): void }) {
    const { t } = useTranslation('agent-chat');
    const fraction = contextFraction(usage);
    const percent = Math.round(fraction * 100);
    const segments = contextSegments(usage);
    const used = formatTokens(usage.contextTokens);
    return (
        <Menu.Group className="flex flex-col gap-2 px-2.5 py-1.5">
            <div className="flex items-center gap-2">
                <Menu.GroupLabel className="min-w-0 grow truncate text-sm font-medium text-text">{t('contextMeter.title')}</Menu.GroupLabel>
                <span className={clsx('shrink-0 text-xs tabular-nums', fraction >= 0.7 ? contextTone(fraction) : 'text-text-faint')}>
                    {usage.contextWindow ? t('contextMeter.of', { used, window: formatTokens(usage.contextWindow) }) : t('contextMeter.used', { tokens: used })}
                </span>
            </div>
            {usage.contextWindow ? (
                <div
                    role="meter"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('contextMeter.aria', { percent })}
                    className="flex h-1.5 overflow-hidden rounded-full bg-surface-sunken"
                >
                    {segments ? (
                        segments.map((segment) => (
                            <div
                                key={segment.part}
                                className={clsx('h-full shrink-0', PART_COLORS[segment.part])}
                                style={{ width: `${segment.fraction * 100}%` }}
                            />
                        ))
                    ) : (
                        <div className={clsx('h-full rounded-full bg-current', contextTone(fraction))} style={{ width: `${percent}%` }} />
                    )}
                </div>
            ) : null}
            {segments && (
                <div className="flex flex-col gap-0.5 text-xs">
                    {segments.map((segment) => (
                        <div key={segment.part} className="flex items-center gap-2">
                            <span aria-hidden="true" className={clsx('size-2 shrink-0 rounded-xs', PART_COLORS[segment.part])} />
                            <span className="min-w-0 grow truncate text-text-muted">{t(`contextMeter.parts.${segment.part}`)}</span>
                            <span className="shrink-0 text-text-faint tabular-nums">
                                {t('contextMeter.estimate', { tokens: formatTokens(segment.tokens) })}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            <div className="flex items-center gap-2 text-xs text-text-faint tabular-nums">
                <span className="min-w-0 grow truncate">
                    {usage.contextWindow ? t('contextMeter.percentUsed', { percent: formatPercent(fraction * 100) }) : null}
                </span>
                <Menu.Item
                    className="flex shrink-0 cursor-default items-center gap-0.5 rounded font-medium text-accent outline-none data-disabled:opacity-50 data-highlighted:underline"
                    disabled={disabled || usage.contextTokens === 0}
                    onClick={onCompact}
                >
                    {t('contextMeter.compactNow')}
                    <Icon icon={ChevronRight} size={12} />
                </Menu.Item>
            </div>
        </Menu.Group>
    );
}

/*
 * One of the model's own knobs: a few choices side by side, more of them in a submenu, a checkbox for
 * a boolean. Every choice is a menu item, so the arrow keys reach it.
 */
function OptionRow({ option, selection, onChange }: { option: ModelOptionDescriptor; selection: ModelSelection; onChange(value: string | boolean): void }) {
    const icon = <Icon icon={optionIcon(option)} size={14} className="shrink-0 text-text-faint" />;
    if (option.type === 'boolean') {
        const checked = (selection.options[option.id] ?? option.defaultValue) === true;
        const item = (
            <Menu.CheckboxItem className="menu-item text-text-muted" checked={checked} onCheckedChange={onChange} closeOnClick={false}>
                {icon}
                <span className="min-w-0 grow truncate">{option.label}</span>
                {/* At the end of the row, where the other knobs of this group keep their control. */}
                <MenuCheck kind="checkbox" />
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
                                        <MenuCheck kind="radio" />
                                        <span className="flex min-w-0 grow flex-col">
                                            {choice.label}
                                            {choice.description && <span className="text-xs text-text-faint">{choice.description}</span>}
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
        <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-text-muted">
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
    );
}
