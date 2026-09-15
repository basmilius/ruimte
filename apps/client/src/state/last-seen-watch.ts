import { pool } from '@/transport';
import { useLastSeen, watchLastSeen } from './last-seen';

/* Keeps `useLastSeen` in step with the pool, and notes every open link once more when the page goes. */
export const startLastSeen = (): (() => void) => {
    const watch = watchLastSeen(pool, Date.now, (endpointId, at) => useLastSeen.getState().see(endpointId, at));
    const onLeave = (): void => watch.flush();
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', onLeave);
    }
    return () => {
        watch.stop();
        if (typeof window !== 'undefined') {
            window.removeEventListener('pagehide', onLeave);
        }
    };
};
