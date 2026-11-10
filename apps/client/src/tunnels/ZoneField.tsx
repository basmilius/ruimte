import { Input, Select } from '@adecore/ui';
import type { TunnelNamed } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';

/* An account may hold dozens of domains; from this many on the list takes a search field. */
const SEARCH_FROM = 8;

interface ZoneFieldProps {
    zones: readonly TunnelNamed[];
    /* The id of the zone picked; falls back to the first one while none is. */
    zone: string;
    label: string;
    disabled?: boolean;
    onZone(zone: string): void;
    onLabel(label: string): void;
}

/* Where a hostname goes: a label, or a full hostname inside the zone, in front of a zone from the list. */
export function ZoneField({ zones, zone, label, disabled, onZone, onLabel }: ZoneFieldProps) {
    const { t } = useTranslation('settings');
    const picked = zones.find((entry) => entry.id === zone) ?? zones[0];

    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <Input
                aria-label={t('tunnels.add.label')}
                className="min-w-0 grow"
                spellCheck={false}
                value={label}
                disabled={disabled}
                onChange={(e) => onLabel(e.target.value)}
            />
            <Select
                label={t('tunnels.add.zone')}
                variant="outlined"
                value={picked?.id ?? ''}
                placeholder={t('tunnels.add.pickZone')}
                items={zones.map((entry) => ({ value: entry.id, label: `.${entry.name}` }))}
                searchable={SEARCH_FROM}
                searchPlaceholder={t('tunnels.add.findZone')}
                disabled={disabled}
                onValueChange={onZone}
            />
        </div>
    );
}
