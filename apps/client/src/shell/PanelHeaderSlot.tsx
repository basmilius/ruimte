import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PanelHeaderHosts {
    leading: HTMLElement | null;
    titleSignal: HTMLElement | null;
    trailing: HTMLElement | null;
}

const PanelHeaderContext = createContext<PanelHeaderHosts>({ leading: null, titleSignal: null, trailing: null });

export function PanelHeaderProvider({ hosts, children }: { hosts: PanelHeaderHosts; children: ReactNode }) {
    return <PanelHeaderContext.Provider value={hosts}>{children}</PanelHeaderContext.Provider>;
}

/* Portal panel-owned controls into the shell header without lifting panel state. */
export function PanelHeaderSlot({ children }: { children: ReactNode }) {
    const host = useContext(PanelHeaderContext).trailing;
    return host === null ? null : createPortal(children, host);
}

export function PanelHeaderLeadingSlot({ children }: { children: ReactNode }) {
    const host = useContext(PanelHeaderContext).leading;
    return host === null ? null : createPortal(children, host);
}

export function PanelHeaderTitleHidden() {
    const host = useContext(PanelHeaderContext).titleSignal;
    return host === null ? null : createPortal(<span />, host);
}
