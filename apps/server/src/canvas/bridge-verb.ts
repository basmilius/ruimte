import { z } from 'zod';
import { defineAction, defineNoun, field } from './verb.ts';

export const bridgeVerb = defineNoun({
    name: 'bridge',
    summary: 'Lists the agents on other machines a person connected to yours',
    detail: [],
    actions: [
        defineAction('bridge', {
            name: 'list',
            summary: 'Lists your connections to agents on other machines',
            usage: '',
            detail: [
                'prints\tbridge\tid\tmachine\tlabel\tone row per connection a person made for your agent',
                'send\truimte-context notify bridge:<id> --text "..." sends a message through that connection',
                'scope\tOnly the chosen agents can exchange messages. This grants no transcript or file access',
                'once\tA message starts one turn and no further, including across machines; a reply from such a turn waits',
                'offline\tThe other machine must be reachable; a failed send is reported and is not queued for retry'
            ],
            positionals: z.tuple([]),
            flags: z.object({}),
            async run(_args, { caller, host }) {
                return (host.bridges?.list(caller) ?? []).map((bridge) => `bridge\t${bridge.id}\t${field(bridge.machineId)}\t${field(bridge.label)}`);
            }
        })
    ]
});
