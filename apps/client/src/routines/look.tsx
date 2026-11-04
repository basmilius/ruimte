import { Icon } from '@adecore/ui';
import clsx from 'clsx';
import { Check, CircleDot, CircleX, Clock, Gauge, Hand, Moon, Pause, SkipForward, type LucideIcon } from 'lucide-react';
import type { BlockLook } from '@/routines/agenda';

const ICONS: Record<BlockLook, { icon: LucideIcon; className: string }> = {
    done: { icon: Check, className: 'text-positive' },
    waited: { icon: Check, className: 'text-positive' },
    waiting: { icon: Hand, className: 'text-status-needs-you' },
    'caught-up': { icon: Moon, className: 'text-text-muted' },
    limit: { icon: Gauge, className: 'text-status-error' },
    skipped: { icon: SkipForward, className: 'text-text-faint' },
    paused: { icon: Pause, className: 'text-text-faint' },
    next: { icon: Clock, className: 'text-text-faint' },
    running: { icon: CircleDot, className: 'text-accent' },
    failed: { icon: CircleX, className: 'text-status-error' }
};

export function LookIcon({ look, size = 12 }: { look: BlockLook; size?: number }) {
    const entry = ICONS[look];
    return <Icon icon={entry.icon} size={size} className={clsx('shrink-0', entry.className)} />;
}
