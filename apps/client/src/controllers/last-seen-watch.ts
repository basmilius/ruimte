import { pool } from '@/transport/index';
import { useLastSeen, watchLastSeen } from '../state/last-seen';

/* Keeps `useLastSeen` in step with the pool, and notes every open link once more when the page goes. */
export function startLastSeen(): () => void {
    const watch = watchLastSeen(pool, Date.now, (endpointId, at) => useLastSeen.getState().see(endpointId, at));

    if (typeof window === 'undefined') {
        return () => watch.stop();
    }

    const onLeave = (): void => watch.flush();
    window.addEventListener('pagehide', onLeave);

    return () => {
        watch.stop();
        window.removeEventListener('pagehide', onLeave);
    };
}
