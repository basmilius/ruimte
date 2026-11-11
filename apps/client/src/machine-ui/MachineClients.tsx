import { useNow } from '@adecore/ui';
import { SettingsRow, TopIcon } from '@adecore/ui/settings';
import type { ConnectedClient, FromMachine } from '@ruimte/contracts';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { clientDescription, clientIcon, clientLabel, groupClients } from '@/machine-ui/machine-clients';
import { MachineListSection } from '@/machine-ui/MachineListSection';
import { useMachineList } from '@/machine-ui/use-machine-list';
import type { Endpoint } from '@/state/endpoints';
import type { Transport } from '@/transport';
import { useMachineAnswers } from '@/transport/features';
import { startMachineWatch } from '@/transport/machine-watch';

const MINUTE_MS = 60_000;

async function readClients(transport: Transport): Promise<FromMachine<ConnectedClient>[]> {
    return (await transport.request('client.list', {})).clients;
}

/* Who is connected to a machine right now. Apart from the access list: that one says who may get in, and a local client has no session in it. */
export function MachineClients({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const answers = useMachineAnswers(endpoint.id, 'client.list');
    const { open, items: clients, failure, load } = useMachineList(endpoint.id, answers, readClients, 'machine.clients');
    const now = useNow(MINUTE_MS);
    const external = clients?.some((client) => client.access === 'mcp') === true;

    useEffect(() => {
        if (!answers) {
            return;
        }

        // The list itself loads again on every reconnect, so the watch only has to listen.
        return startMachineWatch(endpoint.id, {
            watch: 'client.watch',
            unwatch: 'client.unwatch',
            refresh: () => undefined,
            listen: (transport) => [transport.on('client.changed', load)]
        });
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [answers, endpoint.id]);

    // An external MCP client goes quiet without a word from the machine, so its row is read again every minute while one shows.
    useEffect(() => {
        if (external) {
            load();
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [now]);

    if (!answers && open) {
        return null;
    }

    return (
        <MachineListSection words="machine.clients" open={open} items={clients} failure={failure}>
            {clients !== null &&
                groupClients(clients).map((group) => (
                    <SettingsRow
                        key={group.client.id}
                        leading={<TopIcon icon={clientIcon(group.client)} className="text-text-muted" />}
                        label={
                            <span className="break-words">
                                {clientLabel(group.client)}
                                {group.client.current && <span className="ml-1.5 text-xs text-accent">{t('machine.access.thisClient')}</span>}
                            </span>
                        }
                        description={clientDescription(group, now)}
                    />
                ))}
        </MachineListSection>
    );
}
