import { useTranslation } from 'react-i18next';
import { machineMode } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';
import { useTunnels } from '@/tunnels/use-tunnels';

/*
 * The tunnels of a machine as a pane shows them, with what it says while it cannot show them yet. Only the desktop app
 * on the machine they run on manages them; any other window reads the state, changes nothing and says `elsewhere`.
 */
export function useMachineTunnels(endpoint: Endpoint, elsewhere: string) {
    const { t } = useTranslation('settings');
    const tunnels = useTunnels(endpoint.id);
    const manages = endpoint.id === LOCAL_ENDPOINT_ID && machineMode() === 'local';
    const { state } = tunnels;
    const waiting = !tunnels.open
        ? t('machine.notAnswering')
        : !tunnels.answers
          ? t('tunnels.update')
          : state === null
            ? t('tunnels.loading')
            : !manages
              ? elsewhere
              : null;

    return { tunnels, manages, waiting, loading: tunnels.open && tunnels.answers && state === null };
}
