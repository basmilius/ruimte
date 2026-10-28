import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import { Button, ColorSwatch, Field, IconButton, Input, Popover, Segmented, Select, Slider, Switch } from '@adecore/ui';
import type { Tweak, Tweaks, TweakValue } from '@/design/design-protocol';

interface TweaksProps {
    tweaks: Tweaks | null;
    values: Readonly<Record<string, TweakValue>>;
    onChange(name: string, value: TweakValue): void;
    onSave(): void;
}

/*
 * The tweaks a page declares, as a popover under their button: each change shows at once without a
 * turn of the chat, and Save writes the values into the page's declaration. A page that declares none
 * has the button, quiet, with a tooltip saying how a design gets them.
 */
export function DesignTweaks({ tweaks, values, onChange, onSave }: TweaksProps) {
    const { t } = useTranslation('shell');

    if (tweaks === null) {
        return <IconButton icon={SlidersHorizontal} size="sm" label={t('design.tools.tweaks')} tooltip={t('design.tweaks.none')} aria-disabled />;
    }

    return (
        <Popover.Root>
            <IconButton icon={SlidersHorizontal} size="sm" label={t('design.tools.tweaks')} render={<Popover.Trigger />} />
            <Popover.Popup align="end" className="flex w-72 flex-col gap-3 p-3">
                {Object.entries(tweaks).map(([name, tweak]) => (
                    <Field key={name} label={tweak.label ?? name}>
                        <TweakControl name={name} tweak={tweak} value={values[name] ?? tweak.value} onChange={(value) => onChange(name, value)} />
                    </Field>
                ))}
                <div className="flex justify-end border-t border-border pt-3">
                    <Button size="sm" variant="primary" onClick={onSave}>
                        {t('design.tweaks.save')}
                    </Button>
                </div>
            </Popover.Popup>
        </Popover.Root>
    );
}

function TweakControl({ name, tweak, value, onChange }: { name: string; tweak: Tweak; value: TweakValue; onChange(value: TweakValue): void }) {
    const options = tweak.options ?? [];

    switch (tweak.type) {
        case 'color':
            return options.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {options.map((color) => (
                        <ColorSwatch key={color} color={color} picked={value === color} aria-label={color} onClick={() => onChange(color)} />
                    ))}
                </div>
            ) : (
                <Input size="sm" mono value={String(value)} onChange={(event) => onChange(event.target.value)} />
            );
        case 'range':
            return (
                <Slider
                    label={tweak.label ?? name}
                    value={typeof value === 'number' ? value : Number(value)}
                    min={tweak.min ?? 0}
                    max={tweak.max ?? 100}
                    step={tweak.step ?? 1}
                    unit={tweak.unit}
                    onValueChange={onChange}
                />
            );
        case 'select':
            return options.length <= 3 ? (
                <Segmented
                    label={tweak.label ?? name}
                    size="sm"
                    value={String(value)}
                    onValueChange={onChange}
                    options={options.map((option) => ({ id: option, label: option }))}
                    className="w-full"
                />
            ) : (
                <Select
                    label={tweak.label ?? name}
                    size="sm"
                    value={String(value)}
                    onValueChange={onChange}
                    items={options.map((option) => ({ value: option, label: option }))}
                />
            );
        case 'toggle':
            return <Switch label={tweak.label ?? name} checked={value === true} onCheckedChange={onChange} />;
        case 'text':
            return <Input size="sm" value={String(value)} onChange={(event) => onChange(event.target.value)} />;
    }
}
