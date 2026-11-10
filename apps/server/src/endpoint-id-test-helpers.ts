import type { SettingPorts } from './machine-settings.ts';

/* What the daemon would lend, as a test of the identity and its handlers alone has it: no rule, no consent, no broker, a closed door and nothing to follow. */
export const NO_SETTING_PORTS: SettingPorts = {
    describe: () => ({
        keepAwakeLidRule: false,
        agentIntegrations: { providers: [], fixed: false },
        brokerUrl: null,
        brokerFixed: false,
        lan: null,
        lanDoorFixed: false
    }),
    keepAwakeChanged: () => undefined,
    streamingChanged: () => undefined,
    resumeChanged: () => undefined,
    usageStatsChanged: async () => undefined,
    brokerChanged: async () => undefined,
    lanDoorChanged: () => undefined
};

/* The fields of `endpoint.changed` that `NO_SETTING_PORTS` makes an identity announce. */
export const LENT_NOTHING = {
    keepAwakeLidRule: false,
    agentIntegrations: { providers: [], fixed: false },
    brokerUrl: null,
    brokerFixed: false,
    lan: null,
    lanDoorFixed: false
} as const;
