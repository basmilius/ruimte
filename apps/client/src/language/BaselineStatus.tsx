import { CircleCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { Icon } from '@basmilius/desktop-ui';
import type { Baseline, BaselineLevel } from './hover-content';

const BASELINE_MARKS: Record<BaselineLevel, { icon: typeof CircleCheck; color: string }> = {
    widely: { icon: CircleCheck, color: 'text-status-idle' },
    newly: { icon: Sparkles, color: 'text-status-running' },
    limited: { icon: TriangleAlert, color: 'text-status-needs-you' }
};

/* Where a web feature stands across browsers, as one line under a CSS property. */
export function BaselineStatus({ baseline }: { baseline: Baseline }) {
    const { icon, color } = BASELINE_MARKS[baseline.level];
    return (
        <div className="flex items-start gap-1.5 text-xs/[18px] text-text-muted select-text">
            <Icon icon={icon} size={14} className={`mt-px shrink-0 ${color}`} />
            <span className="min-w-0">{baseline.text}</span>
        </div>
    );
}
