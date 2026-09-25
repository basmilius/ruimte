import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
    const query = window.matchMedia(QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;
const getServerSnapshot = () => false;

export function useReducedAnimations() {
    // Match the server's first frame before applying the browser's motion preference.
    const reduced = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    return reduced;
}
