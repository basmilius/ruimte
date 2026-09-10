import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';
import { CheckIcon, ChevronDownIcon, Shield01Icon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons';
import type { InteractionMode, ModelInfo, ModelSelection, RuntimeMode } from '@ruimte/contracts';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { Icon } from '@/ui/Icon';

const triggerClass =
    'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] text-text-muted hover:bg-surface-sunken hover:text-text data-[popup-open]:bg-surface-sunken data-[popup-open]:text-text';

function Popup({ children, minWidth }: { children: React.ReactNode; minWidth?: string }) {
    return (
        <Menu.Portal>
            <Menu.Positioner className="z-50" side="top" sideOffset={8} align="start">
                <Menu.Popup className={clsx('menu-popup', minWidth)}>{children}</Menu.Popup>
            </Menu.Positioner>
        </Menu.Portal>
    );
}

function RadioRow({ value, label, hint, badge }: { value: string; label: string; hint?: string; badge?: string }) {
    return (
        <Menu.RadioItem value={value} className="menu-item">
            <span className="grid h-4 w-4 place-items-center">
                <Menu.RadioItemIndicator>
                    <Icon icon={CheckIcon} size={13} />
                </Menu.RadioItemIndicator>
            </span>
            <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                    {label}
                    {badge && <span className="rounded bg-accent-soft px-1 text-[10px] font-medium uppercase text-accent">{badge}</span>}
                </span>
                {hint && <span className="text-[11px] text-text-faint">{hint}</span>}
            </span>
        </Menu.RadioItem>
    );
}

/* Which model answers: current ones first, legacy ones below a line. */
export function ModelPicker({ models, selection, onChange }: { models: ModelInfo[]; selection: ModelSelection; onChange(model: string): void }) {
    const current = models.find((model) => model.slug === selection.model);
    const live = models.filter((model) => !model.legacy);
    const legacy = models.filter((model) => model.legacy);
    return (
        <Menu.Root>
            <Menu.Trigger className={triggerClass}>
                <span className="max-w-40 truncate">{current?.name ?? selection.model}</span>
                <Icon icon={ChevronDownIcon} size={12} className="text-text-faint" />
            </Menu.Trigger>
            <Popup minWidth="min-w-56">
                <Menu.RadioGroup value={selection.model} onValueChange={(value: string) => onChange(value)}>
                    {live.map((model) => (
                        <RadioRow key={model.slug} value={model.slug} label={model.name} badge={model.badge} />
                    ))}
                    {legacy.length > 0 && <Menu.Separator className="menu-separator" />}
                    {legacy.map((model) => (
                        <RadioRow key={model.slug} value={model.slug} label={model.name} hint="Legacy" />
                    ))}
                </Menu.RadioGroup>
            </Popup>
        </Menu.Root>
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
                <Icon icon={SlidersHorizontalIcon} size={12} />
                <span className="max-w-48 truncate">{summary || 'Options'}</span>
            </Menu.Trigger>
            <Popup minWidth="min-w-52">
                {model.options.map((option, index) => (
                    <div key={option.id}>
                        {index > 0 && <Menu.Separator className="menu-separator" />}
                        <div className="menu-label">{option.label}</div>
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
                                className="menu-item"
                                checked={selection.options[option.id] === true}
                                onCheckedChange={(checked) => onChange(option.id, checked)}
                                closeOnClick={false}
                            >
                                <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">
                                    <Menu.CheckboxItemIndicator>
                                        <Icon icon={CheckIcon} size={12} />
                                    </Menu.CheckboxItemIndicator>
                                </span>
                                {option.label}
                            </Menu.CheckboxItem>
                        )}
                    </div>
                ))}
            </Popup>
        </Menu.Root>
    );
}

/* When the agent has to ask, from ask-for-everything to never. */
export function ModePicker({ runtimeMode, onChange }: { runtimeMode: RuntimeMode; onChange(mode: RuntimeMode): void }) {
    const current = RUNTIME_MODES.find((mode) => mode.id === runtimeMode) ?? RUNTIME_MODES[3]!;
    return (
        <Menu.Root>
            <Menu.Trigger className={clsx(triggerClass, runtimeMode === 'full-access' && 'text-status-needs-you hover:text-status-needs-you')}>
                <Icon icon={Shield01Icon} size={12} />
                <span>{current.label}</span>
            </Menu.Trigger>
            <Popup minWidth="min-w-60">
                <Menu.RadioGroup value={runtimeMode} onValueChange={(value: string) => onChange(value as RuntimeMode)}>
                    {RUNTIME_MODES.map((mode) => (
                        <RadioRow key={mode.id} value={mode.id} label={mode.label} hint={mode.hint} />
                    ))}
                </Menu.RadioGroup>
            </Popup>
        </Menu.Root>
    );
}

/* Plan or build: whether the agent proposes first or goes straight to work. */
export function PlanToggle({ interactionMode, onChange }: { interactionMode: InteractionMode; onChange(mode: InteractionMode): void }) {
    return (
        <div className="flex h-7 items-center rounded-md bg-surface-sunken p-0.5 text-[11px] font-medium">
            {(['default', 'plan'] as const).map((mode) => (
                <button
                    key={mode}
                    className={clsx(
                        'h-6 rounded px-2 transition-colors',
                        interactionMode === mode ? 'bg-surface-raised text-text shadow-sm' : 'text-text-muted hover:text-text'
                    )}
                    onClick={() => onChange(mode)}
                >
                    {mode === 'plan' ? 'Plan' : 'Build'}
                </button>
            ))}
        </div>
    );
}
