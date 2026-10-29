import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@adecore/ui/settings';
import { Switch } from '@adecore/ui';
import { MACHINE_SWITCHES, type MachineSwitch } from '@/shell/settings/machine-switches';
import { usePickedMachine } from '@/shell/settings/picked-machine';
import { useMachineSetting } from '@/shell/settings/machine-setting';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import type { Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useEndpointConnection } from '@/transport/status';

// The i18n group under `agents` each switch reads its words from.
const WORDS: Record<MachineSwitch, string> = { agentsDeleteAnyView: 'deleteAnyView', resumeAtReset: 'resumeAtReset', visualReplies: 'visualReplies' };

function MachineSwitchRow({ endpoint, setting, searchId }: { endpoint: Endpoint; setting: MachineSwitch; searchId?: string }) {
    const { t } = useTranslation('settings');
    const info = useServers((s) => s.byEndpoint[endpoint.id]);
    const connection = useEndpointConnection(endpoint.id);
    const connected = connection.status === 'open';
    const { busy, save } = useMachineSetting(endpoint);
    const words = `agents.${WORDS[setting]}`;

    return (
        <SettingsRow
            searchId={searchId}
            label={t(`${words}.label`)}
            description={
                connected
                    ? t(`${words}.description`)
                    : connection.noLink === true
                      ? t(`${words}.notConnected`, { machine: endpoint.label })
                      : t('machine.notAnswering')
            }
            control={
                <Switch
                    checked={info?.[setting] === true}
                    onCheckedChange={(checked) => void save({ [setting]: checked })}
                    // The section names the machine, a screen reader reading the switch alone does not.
                    label={t(`${words}.rowLabel`, { machine: endpoint.label })}
                    disabled={busy || !connected}
                />
            }
        />
    );
}

/*
 * What agents may do on the machine picked in the section's tag, under the settings about agents and
 * chats rather than in the Account pane. That pane is about reaching a machine and whether it answers;
 * this is about an agent.
 */
export function MachineSwitchSection({ title, settings = MACHINE_SWITCHES }: { title: string; settings?: readonly MachineSwitch[] }) {
    const { t } = useTranslation('settings');
    const endpoint = usePickedMachine();

    if (endpoint === null) {
        return null;
    }

    return (
        <SettingsSection title={title} description={t('agents.machine.description')} scope="machine" machine="picked">
            {settings.map((setting) => (
                <MachineSwitchRow key={`${endpoint.id}:${setting}`} endpoint={endpoint} setting={setting} searchId={`agents.${WORDS[setting]}`} />
            ))}
        </SettingsSection>
    );
}
