import { Input, Select } from '@adecore/ui';
import type { TunnelNamed } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';

export interface ZoneFieldProps {
    zones: readonly TunnelNamed[];
    /* The id of the zone picked; falls back to the first one while none is. */
    zone: string;
    label: string;
    labelName: string;
    onZone(zone: string): void;
    onLabel(label: string): void;
}

/* Where a hostname goes: a zone from the list, and a label in front of it or a full hostname inside it. */
export function ZoneField({ zones, zone, label, labelName, onZone, onLabel }: ZoneFieldProps) {
    const { t } = useTranslation('settings');
    const picked = zones.find((entry) => entry.id === zone) ?? zones[0];

    return (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Input aria-label={labelName} spellCheck={false} value={label} onChange={(e) => onLabel(e.target.value)} />
            <Select<string>
                label={t('tunnels.zone.label')}
                variant="outlined"
                value={picked?.id ?? ''}
                placeholder={t('tunnels.zone.pick')}
                items={zones.map((entry) => ({ value: entry.id, label: `.${entry.name}` }))}
                onValueChange={onZone}
            />
        </div>
    );
}
