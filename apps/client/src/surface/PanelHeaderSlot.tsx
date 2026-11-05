import { Separator } from '@adecore/ui';
import { Children, createContext, Fragment, isValidElement, useContext, type ReactNode } from 'react';
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

/* The panel's actions at the end of its header: each child is one group, with the toolbar's separator between groups. */
export function PanelHeaderActions({ children }: { children: ReactNode }) {
    const groups = Children.toArray(children);
    return (
        <div className="ml-auto flex shrink-0 items-center gap-2">
            {groups.map((group, index) => (
                <Fragment key={isValidElement(group) && group.key !== null ? group.key : index}>
                    {index > 0 && <Separator />}
                    {group}
                </Fragment>
            ))}
        </div>
    );
}

export function PanelHeaderLeadingSlot({ children }: { children: ReactNode }) {
    const host = useContext(PanelHeaderContext).leading;
    return host === null ? null : createPortal(children, host);
}

export function PanelHeaderTitleHidden() {
    const host = useContext(PanelHeaderContext).titleSignal;
    return host === null ? null : createPortal(<span />, host);
}
