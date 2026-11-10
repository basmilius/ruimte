/*
 * What the client wants from the shell's power block. The client knows whether an agent works and
 * what a person chose; only the shell knows the power source, which changes under a running app,
 * so the client says what it wants and the shell decides, live, whether that holds right now.
 */
export interface KeepAwakeRequest {
    /* Hold the block on battery as well. Off, the block holds on the power adapter only. */
    onBattery: boolean;
    display: boolean;
}

/* What the system says of its person, as Electron's `powerMonitor.getSystemIdleState` names it. */
export type SystemIdleState = 'active' | 'idle' | 'locked' | 'unknown';
