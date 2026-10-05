import { useCallback, useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { formatNumber } from '@basmilius/desktop-ui/format';
import { useToasts } from '@/state/toasts';
import type { LanguageStatusTracker } from './status';
import { nameOf } from './status-view';

export function useStatuses(tracker: LanguageStatusTracker): readonly LanguageServerStatus[] {
    const subscribe = useCallback((listener: () => void) => tracker.subscribe(listener), [tracker]);
    return useSyncExternalStore(subscribe, () => tracker.getSnapshot());
}

/* Says a failed request aloud, since the row it came from has nowhere to put a sentence. */
export function report(error: unknown, t: (key: string, options: { message: string }) => string): void {
    useToasts.getState().show({
        id: 'language-request-failed',
        kind: 'error',
        title: t('language.failed', { message: error instanceof Error ? error.message : String(error) })
    });
}

/* The line under a server: why it is down, what installing does, or how many files it serves; empty when there is nothing to add. */
export function serverDetail(status: LanguageServerStatus, t: TFunction<'panels'>): string {
    if (status.state === 'crashed' || (status.state === 'not-installed' && status.message !== undefined)) {
        return status.message ?? '';
    }
    if (status.state === 'not-installed' && status.unavailable === true) {
        return t('language.unavailable');
    }
    if (status.state === 'not-installed') {
        return t('language.installDetail', { name: nameOf(status.server, [status]), version: status.version });
    }
    return status.documents > 0 ? t('language.documents', { count: status.documents, formatted: formatNumber(status.documents) }) : '';
}

/* A line for each sidecar of the kind, such as the TypeScript 6 process that answers the code actions TypeScript 7 lacks. */
export function sidecarDetails(status: LanguageServerStatus, t: TFunction<'panels'>): string[] {
    return (status.sidecars ?? []).map((sidecar) => t(`language.sidecar.${sidecar.state}`, { title: sidecar.title, message: sidecar.message ?? '' }));
}
