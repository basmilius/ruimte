import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
    window.addEventListener('resize', onChange);

    return () => window.removeEventListener('resize', onChange);
}

function windowWidth(): number {
    return window.innerWidth;
}

export function useWindowWidth(): number {
    return useSyncExternalStore(subscribe, windowWidth, windowWidth);
}
