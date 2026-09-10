import type { ReactElement, ReactNode } from 'react';
import clsx from 'clsx';
import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import { TOOLTIP_KBD } from '@/ui/classes';

type Side = 'top' | 'bottom' | 'left' | 'right';

/* One provider per app: tooltips share a delay, so moving along a row of buttons feels instant. */
export function TooltipProvider({ children }: { children: ReactNode }) {
    return (
        <BaseTooltip.Provider delay={150} closeDelay={0}>
            {children}
        </BaseTooltip.Provider>
    );
}

interface TooltipProps {
    label: ReactNode;
    kbd?: string;
    side?: Side;
    /* Makes the label the accessible name of the trigger as well: what an icon-only button needs,
       and the way to keep the name and the tooltip from ever saying two different things. */
    name?: boolean;
    /* The trigger element. Its own children and handlers are kept; Base UI merges the tooltip props in. */
    children: ReactElement<Record<string, unknown>>;
}

export function Tooltip({ label, kbd, side = 'top', name = false, children }: TooltipProps) {
    return (
        <BaseTooltip.Root>
            <BaseTooltip.Trigger render={children} aria-label={name && typeof label === 'string' ? label : undefined} />
            <BaseTooltip.Portal>
                <BaseTooltip.Positioner side={side} sideOffset={6} className="tooltip-positioner">
                    <BaseTooltip.Popup className="tooltip-popup">
                        <BaseTooltip.Viewport className="px-[9px] py-[5px] whitespace-nowrap">
                            <span>{label}</span>
                            {/* The viewport wraps its children in a div of its own, so the 8px
                                between the label and the chord has to sit on the chord itself. */}
                            {kbd && <kbd className={clsx(TOOLTIP_KBD, 'ml-2')}>{kbd}</kbd>}
                        </BaseTooltip.Viewport>
                    </BaseTooltip.Popup>
                </BaseTooltip.Positioner>
            </BaseTooltip.Portal>
        </BaseTooltip.Root>
    );
}
