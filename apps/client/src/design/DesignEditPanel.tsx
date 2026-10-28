import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, Input } from '@adecore/ui';
import type { DesignElement } from '@/design/design-protocol';

/* The properties the panel offers, with the key the page reports its computed value under. */
const PROPERTIES = [
    { property: 'color', key: 'color' },
    { property: 'background-color', key: 'backgroundColor' },
    { property: 'font-size', key: 'fontSize' },
    { property: 'font-weight', key: 'fontWeight' },
    { property: 'line-height', key: 'lineHeight' },
    { property: 'text-align', key: 'textAlign' },
    { property: 'padding', key: 'paddingTop' },
    { property: 'margin', key: 'marginTop' },
    { property: 'gap', key: 'gap' },
    { property: 'border-radius', key: 'borderRadius' },
    { property: 'width', key: 'width' },
    { property: 'height', key: 'height' },
    { property: 'opacity', key: 'opacity' }
] as const;

interface EditPanelProps {
    element: DesignElement | null;
    pending: boolean;
    onStyle(property: string, value: string): void;
    onSave(): void;
    onDiscard(): void;
    onBake(): void;
}

/*
 * The panel of Edit: the computed style of the picked element, each property set by hand and shown at
 * once. Save writes what was set into the page's overrides block without a turn of the chat; Fold in
 * asks the chat to move that block into the source. Text changes in place, with a double click.
 */
export function DesignEditPanel({ element, pending, onStyle, onSave, onDiscard, onBake }: EditPanelProps) {
    const { t } = useTranslation('shell');

    return (
        <div className="menu-popup absolute top-2 right-2 bottom-2 z-10 flex w-64 flex-col gap-3 overflow-y-auto p-3">
            {element === null ? (
                <p className="text-xs text-text-muted">{t('design.edit.hint')}</p>
            ) : (
                <>
                    <span className="truncate font-mono text-xs text-text-muted">
                        {element.option === null ? '' : `${element.option} · `}
                        {element.name}
                    </span>
                    {/* Keyed on the element, so its fields start from its own values. */}
                    <div key={element.selector} className="flex flex-col gap-2">
                        {PROPERTIES.map(({ property, key }) => (
                            <StyleField key={property} property={property} initial={element.style[key] ?? ''} onSet={(value) => onStyle(property, value)} />
                        ))}
                    </div>
                </>
            )}
            <span className="grow" />
            <div className="flex flex-wrap justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={onBake}>
                    {t('design.edit.bake')}
                </Button>
                <Button size="sm" variant="ghost" disabled={!pending} onClick={onDiscard}>
                    {t('design.edit.discard')}
                </Button>
                <Button size="sm" variant="primary" disabled={!pending} onClick={onSave}>
                    {t('design.edit.save')}
                </Button>
            </div>
        </div>
    );
}

function StyleField({ property, initial, onSet }: { property: string; initial: string; onSet(value: string): void }) {
    const [value, setValue] = useState(initial);
    const commit = (): void => {
        if (value.trim() !== '' && value !== initial) {
            onSet(value.trim());
        }
    };

    return (
        <Field label={property}>
            <Input
                size="sm"
                mono
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        commit();
                    }
                }}
            />
        </Field>
    );
}
