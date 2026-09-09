import type { ReactElement, ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';

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
    /* The trigger element. Its own children and handlers are kept; Base UI merges the tooltip props in. */
    children: ReactElement<Record<string, unknown>>;
}

export function Tooltip({ label, kbd, side = 'top', children }: TooltipProps) {
    return (
        <BaseTooltip.Root>
            <BaseTooltip.Trigger render={children} />
            <BaseTooltip.Portal>
                <BaseTooltip.Positioner side={side} sideOffset={6} className="tooltip-positioner">
                    <BaseTooltip.Popup className="tooltip-popup">
                        <BaseTooltip.Viewport className="tooltip-viewport">
                            <span>{label}</span>
                            {kbd && <kbd className="tooltip-kbd">{kbd}</kbd>}
                        </BaseTooltip.Viewport>
                    </BaseTooltip.Popup>
                </BaseTooltip.Positioner>
            </BaseTooltip.Portal>
        </BaseTooltip.Root>
    );
}
