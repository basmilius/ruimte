/* The sessions the shell made for shared ports, so the guards of the other browser pages can tell their pages from any other. */
const sessions = new WeakSet<object>();

export function markTunnelSession(session: object): void {
    sessions.add(session);
}

export function isTunnelSession(session: object): boolean {
    return sessions.has(session);
}
