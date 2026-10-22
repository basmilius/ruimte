import i18next from 'i18next';
import { brokerHostOf } from '@ruimte/pulsar';
import type { ReachCheck } from '@ruimte/contracts';

/* The i18n key of a cause; a cause a newer machine names reads as unknown. */
function causeKey(check: ReachCheck): string {
    switch (check.cause) {
        case 'ok':
            return 'ok';
        case 'broker-off':
            return 'brokerOff';
        case 'broker-unreachable':
            return 'brokerUnreachable';
        case 'no-relay':
            return 'noRelay';
        case 'turn-unreachable':
            return 'turnUnreachable';
        case 'turn-refused':
            return 'turnRefused';
        case 'udp-blocked':
            return 'udpBlocked';
        case 'vpn-blocks-udp':
            return check.severity === 'relayed' ? 'vpnRelayed' : 'vpnBlocked';
        case 'blocked':
            return 'blocked';
        case 'lan-door-down':
            return 'lanDoorDown';
        default:
            return 'unknown';
    }
}

/* What the machine's row says about a check: what is wrong, and what a person can do about it; null when nothing is. */
export function reachText(check: ReachCheck): { problem: string; fix: string | null } {
    const key = causeKey(check);
    const values = {
        broker: check.facts.broker.url === null ? '' : brokerHostOf(check.facts.broker.url),
        tunnel: check.facts.tunnel ?? '',
        port: check.facts.lanDoor.port === null ? '' : String(check.facts.lanDoor.port),
        cause: check.cause
    };
    const problem = i18next.t(`settings:machine.reach.causes.${key}.problem`, values);
    const fix = key === 'ok' || key === 'unknown' ? null : i18next.t(`settings:machine.reach.causes.${key}.fix`, values);
    return { problem, fix };
}
