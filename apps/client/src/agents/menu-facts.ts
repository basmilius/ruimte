import { providersOf } from '@adecore/agents-react/state';
import { inPickerOrder } from '@ruimte/contracts';
import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { currentEndpointId } from '@/state/current-endpoint';

export interface MenuAgent {
    kind: string;
    name: string;
    chat: boolean;
    terminal: boolean;
}

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* The CLIs installed on the project's machine, in the picker's order. */
        agents: MenuAgent[];
    }
}

export function agentFacts(_host: MenuHost): Pick<MenuFacts, 'agents'> {
    const { providers } = providersOf(currentEndpointId());

    return {
        agents: inPickerOrder(providers.filter((provider) => provider.installed)).map((provider) => ({
            kind: provider.kind,
            name: provider.name,
            chat: provider.capabilities.chat,
            terminal: provider.capabilities.terminal
        }))
    };
}
