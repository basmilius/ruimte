import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

/* The mark in front of the line: a decision to make, a failure to read, or something that happened. */
export type BannerTone = 'attention' | 'error' | 'neutral';

const TONE: Record<BannerTone, string> = {
    attention: 'text-status-needs-you',
    error: 'text-status-error',
    neutral: 'text-text-muted'
};

/*
 * The strip over the views: one line and the buttons that answer it. It is where this app puts
 * anything that waits for a person (the save conflict, the failure, a view an agent asks for),
 * because a corner toast is read after the fact and a decision has to be where the eyes already are.
 * One at a time: the slot is one row and the caller picks what stands in it.
 */
export function Banner({ icon, tone, message, children }: { icon: LucideIcon; tone: BannerTone; message: ReactNode; children?: ReactNode }) {
    return (
        <div className="pointer-events-auto absolute inset-x-0 top-3 z-20 flex justify-center px-4" role="status" aria-live="polite">
            <div className={`${FLOAT} flex max-w-[640px] items-center gap-3 rounded-lg px-3 py-2 text-sm text-text`}>
                <Icon icon={icon} size={16} className={clsx('shrink-0', TONE[tone])} />
                <span className="grow">{message}</span>
                {children}
            </div>
        </div>
    );
}
