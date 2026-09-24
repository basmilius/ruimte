import i18next from 'i18next';
import { useComputer } from '@/state/computer';
import { watchPool } from '@/transport/pool-watch';

/*
 * The computer use cards and status of every machine this client holds a socket for. The daemon tells
 * every socket the whole list and the status whenever they change; a socket that opens asks once.
 * A machine with computer use on hears when the interface language changes, so its overlay speaks it.
 */
export const startComputerWatch = (): (() => void) =>
    watchPool((link, endpointId) => {
        let language = i18next.language;
        const onLanguage = (next: string): void => {
            // A region change redraws with the same language, which the overlay does not need to hear.
            if (next === language) {
                return;
            }
            language = next;
            if (useComputer.getState().statuses[endpointId]?.enabled) {
                // A daemon from before this request keeps the words it has.
                link.request('computer.setLanguage', { language: next }).catch(() => undefined);
            }
        };
        i18next.on('languageChanged', onLanguage);
        return {
            onOpen: () => {
                // A daemon from before computer use does not know the requests; it simply has no cards and no status.
                link.request('computer.approvals', {})
                    .then((result) => useComputer.getState().setApprovals(endpointId, result.approvals))
                    .catch(() => undefined);
                link.request('computer.status', {})
                    .then((status) => useComputer.getState().setStatus(endpointId, status))
                    .catch(() => undefined);
            },
            subscriptions: [
                link.on('computer.approvals', (payload) => useComputer.getState().setApprovals(endpointId, payload.approvals)),
                link.on('computer.status', (payload) => useComputer.getState().setStatus(endpointId, payload)),
                () => i18next.off('languageChanged', onLanguage),
                () => useComputer.getState().forget(endpointId)
            ]
        };
    });
