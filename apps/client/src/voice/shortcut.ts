interface VoiceShortcutActions {
    available(): boolean;
    active(): boolean;
    start(): void;
    stop(): void;
}

export function createVoiceShortcut(actions: VoiceShortcutActions) {
    let pressedAt: number | null = null;

    return {
        press(timeStamp: number, repeat: boolean): boolean {
            if (!actions.available() && !actions.active()) {
                return false;
            }
            if (repeat) {
                return true;
            }
            if (actions.active()) {
                pressedAt = null;
                actions.stop();
            } else {
                pressedAt = timeStamp;
                actions.start();
            }
            return true;
        },
        release(event: { code: string; key: string; timeStamp: number }): void {
            if (pressedAt === null || (event.code !== 'KeyM' && !['Meta', 'Control', 'Shift'].includes(event.key))) {
                return;
            }
            const held = event.timeStamp - pressedAt >= 400;
            pressedAt = null;
            if (held && actions.active()) {
                actions.stop();
            }
        },
        blur(): void {
            const pending = pressedAt !== null;
            pressedAt = null;
            if (pending && actions.active()) {
                actions.stop();
            }
        }
    };
}
