import { useState } from 'react';
import { Input } from '@adecore/ui';

/* A whole number a person types, kept as text until they leave the field, and sent once if it is one inside the range. */
export function CountField({
    value,
    min,
    max,
    label,
    disabled,
    onCommit
}: {
    value: number;
    min: number;
    max: number;
    label: string;
    disabled: boolean;
    onCommit(next: number): void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = (): void => {
        const next = Number(draft);
        setDraft(null);
        if (draft !== null && Number.isInteger(next) && next >= min && next <= max && next !== value) {
            onCommit(next);
        }
    };
    return (
        <Input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={draft ?? String(value)}
            aria-label={label}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    commit();
                }
            }}
        />
    );
}
