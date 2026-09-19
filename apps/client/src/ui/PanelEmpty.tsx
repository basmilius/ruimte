import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

interface PanelEmptyProps {
    /* The panel's own header, kept above the sentence so a person can still act while nothing is listed. */
    header?: ReactNode;
    icon: LucideIcon;
    iconSize?: number;
    spin?: boolean;
    action?: ReactNode;
    /* The ground a node body sits on, which a panel inside the shell already has behind it. */
    sunken?: boolean;
    /*
     * A panel is one track of a flex column and takes what is left of it; a node body is a box with
     * a height of its own, and `grow` means nothing to the block that lays it out.
     */
    fill?: 'grow' | 'full';
    children: ReactNode;
}

/* What a panel or a node body shows while it holds nothing: a sentence, one icon, at most one button. */
export function PanelEmpty({ header, icon, iconSize = 20, spin = false, action, sunken = false, fill = 'grow', children }: PanelEmptyProps) {
    return (
        <div className={clsx('grid min-h-0 place-items-center', fill === 'full' ? 'h-full' : 'grow', sunken && 'bg-surface-sunken')}>
            {header}
            <EmptyState icon={<Icon icon={icon} size={iconSize} className={spin ? 'animate-spin' : undefined} />} action={action}>
                {children}
            </EmptyState>
        </div>
    );
}
