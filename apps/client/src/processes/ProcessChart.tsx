import { createChart, type ChartX } from '@adecore/charts';
import { SectionLabel } from '@adecore/ui';
import { formatClock } from '@adecore/ui/format';
import type { ProcessPoint } from '@ruimte/contracts';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const HEIGHT = 44;

const SampleChart = createChart<ProcessPoint>();

interface ProcessChartProps {
    label: ReactNode;
    /* What a screen reader calls the chart, which only decorates the readout above it. */
    name: string;
    /* What the chart says while nobody points at it: the value now. */
    headline: string;
    points: readonly ProcessPoint[];
    windowMs: number;
    /* The daemon's clock of the newest sample, so a machine whose clock differs from this one still ends at the right edge. */
    end: number;
    max: number;
    machine(point: ProcessPoint): number | null;
    ruimte(point: ProcessPoint): number | null;
    format(value: number): string;
}

/*
 * One measure over time: the whole machine as a line and the share of Ruimte as the area under it,
 * so a glance says whether Ruimte is what makes the machine slow or something else is.
 */
export function ProcessChart({ label, name, headline, points, windowMs, end, max, machine, ruimte, format }: ProcessChartProps) {
    const { t } = useTranslation('panels');
    const [active, setActive] = useState<ChartX | null>(null);
    const start = end - windowMs;
    const visible = points.filter((point) => point.at >= start);
    const hovered = active === null ? undefined : visible.find((point) => point.at === active);

    const readout = (point: ProcessPoint): string => {
        const whole = machine(point);
        const share = ruimte(point);
        return `${formatClock(point.at)}: ${whole === null ? '-' : format(whole)}, Ruimte ${share === null ? '-' : format(share)}`;
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
                <SectionLabel>{label}</SectionLabel>
                <span className="grow" />
                <span className="truncate text-xs text-text tabular-nums">{hovered === undefined ? headline : readout(hovered)}</span>
            </div>
            <SampleChart.Root
                data={visible}
                x="at"
                xScale="time"
                step={0}
                xOptions={{ min: start, max: end }}
                y={{ min: 0, max }}
                height={HEIGHT}
                margin={{ top: 1, right: 0, bottom: 1, left: 0 }}
                interactive={false}
                cursor="line"
                label={name}
                onActiveXChange={setActive}
            >
                <SampleChart.Grid lines="ground" dashed />
                <SampleChart.Area value={ruimte} label="Ruimte" tone="accent" width={0} fill="flat" />
                <SampleChart.Line value={machine} label={t('processes.legend.machine')} tone={{ color: 'var(--text-muted)' }} width={1} />
            </SampleChart.Root>
        </div>
    );
}
