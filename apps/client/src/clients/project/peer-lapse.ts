import { create } from 'zustand';

/*
 * The machines whose peer link this window could not renew, so agents there cannot give tasks yet. The
 * nodes of such a machine keep working: they run on the window's own connection, not on the link.
 */
export const usePeerLapse = create<{ lapsed: Readonly<Record<string, true>> }>(() => ({ lapsed: {} }));

export function markPeerLapsed(machineId: string, lapsed: boolean): void {
    usePeerLapse.setState((state) => {
        const next = withMark(state.lapsed, machineId, lapsed);
        return next === state.lapsed ? state : { lapsed: next };
    });
}

/* The set of marked machines with one turned on or off, the same object when nothing changes. */
export function withMark(marks: Readonly<Record<string, true>>, machineId: string, on: boolean): Readonly<Record<string, true>> {
    if ((marks[machineId] === true) === on) {
        return marks;
    }
    if (on) {
        return { ...marks, [machineId]: true };
    }
    const { [machineId]: _dropped, ...rest } = marks;
    return rest;
}
