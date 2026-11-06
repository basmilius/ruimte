import i18next from 'i18next';
import { useComputer } from '@/computer/computer';
import { pool } from '@/transport';
import { joinWatches, snapshotWatch, watchPool, type WatchablePool } from '@/transport/pool-watch';

/*
 * The computer use cards, status and grants of every machine this client holds a socket for. The daemon
 * tells every socket the whole of each whenever it changes; a socket that opens asks once.
 * A machine with computer use on hears when the interface language changes, so its overlay speaks it.
 */
export function startComputerWatch(source: WatchablePool = pool): () => void {
    return watchPool((link, endpointId) => {
        let language = i18next.language;
        const onLanguage = (next: string): void => {
            // A region change redraws with the same language, which the overlay does not need to hear.
            if (next === language) {
                return;
            }
            language = next;
            if (useComputer.getState().statuses[endpointId]?.enabled) {
                // A failed ask keeps the words the overlay has.
                link.request('computer.setLanguage', { language: next }).catch(() => undefined);
            }
        };
        i18next.on('languageChanged', onLanguage);
        const computer = useComputer.getState;

        return joinWatches(
            snapshotWatch(link, 'computer.approvals', 'computer.approvals', (payload) => computer().setApprovals(endpointId, payload.approvals)),
            snapshotWatch(link, 'computer.status', 'computer.status', (status) => computer().setStatus(endpointId, status)),
            snapshotWatch(link, 'computer.grants', 'computer.grants', (grants) => computer().setGrants(endpointId, grants)),
            { subscriptions: [() => i18next.off('languageChanged', onLanguage), () => computer().forget(endpointId)] }
        );
    }, source);
}
