let altDown = false;
const listeners = new Set<() => void>();

export function isGapModifierDown(): boolean {
    return altDown;
}

export function setGapModifierDown(down: boolean): void {
    if (down === altDown) {
        return;
    }
    altDown = down;
    for (const listener of listeners) {
        listener();
    }
}

export function subscribeGapModifier(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            altDown = false;
        }
    };
}
