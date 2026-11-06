import { errorText } from '../error-text.ts';
import type { SettingPorts } from '../machine-settings.ts';
import type { AgentsBundle } from './agents.ts';
import type { DevicesBundle } from './devices.ts';
import type { NetworkBundle } from './network.ts';
import type { PowerBundle } from './power.ts';
import type { ProvidersBundle } from './providers.ts';
import type { UsageStatsBundle } from './usage-stats.ts';

interface SettingPortsInput {
    stats: UsageStatsBundle;
    providers: ProvidersBundle;
    agents: AgentsBundle;
    devices: DevicesBundle;
    power: PowerBundle;
    network: NetworkBundle;
}

/* What the machine's settings follow a change with, and describe themselves by, in the parts that run them. */
export function wireSettingPorts({ stats, providers, agents, devices, power, network }: SettingPortsInput): SettingPorts {
    return {
        describe: () => ({
            keepAwakeLidRule: power.closedLid.ruleInstalled,
            agentIntegrations: providers.integrations.summary(),
            ...network.brokerSwitch.describe(),
            ...network.describeLanDoor()
        }),
        keepAwakeChanged: power.checkAwake,
        // A disabled policy stops streams already in flight as well as refusing the next one.
        streamingChanged: (allowed) => {
            if (!allowed) {
                devices.browsers.closeAll();
                devices.devices.closeAll();
            }
        },
        // Chats take up a limited turn on a clock only while this is on.
        resumeChanged: (on) => {
            agents.chats.resumeSettingChanged();
            // A chat nobody loaded owes a resume only on disk, so turning the switch off drops those there.
            if (!on) {
                void agents.outboxLink.lapseLimitResume().catch((e: unknown) => console.error('Dropping the resumes after a limit failed:', errorText(e)));
            }
        },
        // Off drops the days not sent yet, so nothing counted before goes out later.
        usageStatsChanged: (on) => stats.changed(on),
        brokerChanged: () => network.brokerSwitch.apply(),
        lanDoorChanged: () => {
            if (network.lanDoorWanted()) {
                network.lanDoor.start();
            } else {
                network.lanDoor.stop();
            }
        }
    };
}
