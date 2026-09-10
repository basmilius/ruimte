import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* The element in the panel's header a panel may put controls in; null while no panel is mounted. */
const PanelHeaderContext = createContext<HTMLElement | null>(null);

export const PanelHeaderProvider = PanelHeaderContext.Provider;

/*
 * Controls of a panel that belong in the panel's own header, next to its name. The header is drawn
 * by `Panel.tsx` above the body, so a panel that has to fill it would otherwise need its state in
 * two components; this puts the markup where the state already is and portals it up.
 */
export function PanelHeaderSlot({ children }: { children: ReactNode }) {
    const host = useContext(PanelHeaderContext);
    return host === null ? null : createPortal(children, host);
}
