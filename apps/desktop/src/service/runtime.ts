import { join } from 'node:path';
import { LAUNCH_AGENT_LABEL, SYSTEMD_UNIT_NAME } from '@ruimte/service';

export interface DesktopRuntimeFacts {
    packaged: boolean;
    productName: string;
    homeDirectory: string;
}

export interface DesktopRuntime {
    defaultPort: number;
    daemonHome: string;
    daemonArgs: string[];
    launchAgentLabel: string;
    systemdUnitName: string;
}

const isLocalRustProduct = (productName: string): boolean => productName === 'Ruimte Rust' || productName === 'ruimte-rust';

export const desktopRuntime = (facts: DesktopRuntimeFacts): DesktopRuntime => {
    if (!facts.packaged) {
        return {
            defaultPort: 4221,
            daemonHome: join(facts.homeDirectory, '.ruimte-rust-dev'),
            daemonArgs: [],
            launchAgentLabel: LAUNCH_AGENT_LABEL,
            systemdUnitName: SYSTEMD_UNIT_NAME
        };
    }
    if (isLocalRustProduct(facts.productName)) {
        return {
            defaultPort: 4211,
            daemonHome: join(facts.homeDirectory, '.ruimte'),
            daemonArgs: ['--no-broker'],
            launchAgentLabel: 'app.ruimte.rust.daemon',
            systemdUnitName: 'ruimte-rust-daemon.service'
        };
    }
    return {
        defaultPort: 4210,
        daemonHome: join(facts.homeDirectory, '.ruimte'),
        daemonArgs: [],
        launchAgentLabel: LAUNCH_AGENT_LABEL,
        systemdUnitName: SYSTEMD_UNIT_NAME
    };
};
