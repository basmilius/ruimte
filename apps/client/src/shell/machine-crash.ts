import i18next from 'i18next';
import type { DaemonCrash } from '@/desktop/bridge';
import type { Toast } from '@/state/toasts';

/* What a window says when the app's own machine ended by itself: once for every end, and to stay once the app gave up on it. */
export const machineCrashToast = (previous: DaemonCrash | null, next: DaemonCrash | null): Toast | null => {
    if (next === null || (previous !== null && previous.total === next.total && previous.restarting === next.restarting)) {
        return null;
    }
    return {
        id: 'machine-crash',
        kind: 'error',
        title: i18next.t('shell:machineCrash.title'),
        description: i18next.t(next.restarting ? 'shell:machineCrash.restarting' : 'shell:machineCrash.gaveUp'),
        persist: !next.restarting
    };
};
