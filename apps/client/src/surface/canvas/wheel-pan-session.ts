export const PAN_IDLE_MS = 160;

export function createWheelPanSession() {
    let last: number | null = null;
    return {
        owns(explicit: boolean, now: number): boolean {
            return explicit || (last !== null && now - last <= PAN_IDLE_MS);
        },
        record(now: number): void {
            last = now;
        },
        reset(): void {
            last = null;
        }
    };
}
