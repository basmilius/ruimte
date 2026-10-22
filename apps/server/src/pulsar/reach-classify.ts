import type { ReachCause, ReachFacts, ReachProbe, ReachSeverity } from '@ruimte/contracts';

export interface ReachVerdict {
    cause: ReachCause;
    severity: ReachSeverity;
}

function works(probes: readonly ReachProbe[]): boolean {
    return probes.some((probe) => probe.outcome === 'ok');
}

// A server that answered, even with a refusal, proves the packets got out and back.
function answered(probes: readonly ReachProbe[]): boolean {
    return probes.some((probe) => probe.outcome !== 'unreachable');
}

/*
 * The one cause that explains what the facts show, the worst first: without a broker nobody away from
 * this network signals at all, without a relay a strict NAT on either side stops a connection, and a
 * closed door only costs the local network a shortcut.
 */
export function classifyReach(facts: ReachFacts): ReachVerdict {
    const lanOpen = facts.lanDoor.listening && facts.lanDoor.addresses > 0;
    const elsewhere: ReachSeverity = lanOpen ? 'limited' : 'unreachable';
    if (facts.broker.url === null) {
        return { cause: 'broker-off', severity: elsewhere };
    }
    if (!facts.broker.connected) {
        return { cause: 'broker-unreachable', severity: elsewhere };
    }
    const udp = facts.probes.filter((probe) => probe.transport === 'udp');
    const turn = facts.probes.filter((probe) => probe.kind === 'turn');
    if (udp.length > 0 && !answered(udp)) {
        const streamTurn = turn.filter((probe) => probe.transport !== 'udp');
        if (works(streamTurn)) {
            // A tunnel that carries TCP but drops UDP is the usual reason, and the one a person can change.
            return { cause: facts.tunnel === null ? 'udp-blocked' : 'vpn-blocks-udp', severity: 'relayed' };
        }
        if (answered(streamTurn)) {
            return { cause: 'turn-refused', severity: 'unreachable' };
        }
        return { cause: facts.tunnel === null ? 'blocked' : 'vpn-blocks-udp', severity: 'unreachable' };
    }
    if (!facts.granted || turn.length === 0) {
        return { cause: 'no-relay', severity: 'limited' };
    }
    if (!works(turn)) {
        return { cause: answered(turn) ? 'turn-refused' : 'turn-unreachable', severity: 'limited' };
    }
    if (facts.lanDoor.wanted && !facts.lanDoor.listening) {
        return { cause: 'lan-door-down', severity: 'limited' };
    }
    return { cause: 'ok', severity: 'ok' };
}

/* What `ruimte status` says for a cause: what is wrong, then what a person can do about it. */
export function reachAdvice(cause: string, facts: ReachFacts): { problem: string; fix: string | null } {
    switch (cause as ReachCause) {
        case 'ok':
            return { problem: 'Other devices can reach this machine, directly or through the relay.', fix: null };
        case 'broker-off':
            return {
                problem: 'The broker is off, so no device away from this network can reach this machine.',
                fix: 'Turn the broker on under Settings, Machines, or start without --no-broker.'
            };
        case 'broker-unreachable':
            return {
                problem: `This machine cannot reach the broker at ${facts.broker.url ?? 'its URL'}, so no device away from this network can find it.`,
                fix: 'Check the internet connection, and that a firewall or proxy lets this machine open a secure WebSocket to the broker.'
            };
        case 'no-relay':
            return {
                problem: 'The broker handed out no relay (TURN) server, so a device behind a strict NAT or firewall cannot connect.',
                fix: 'Use a broker that hands out a relay, such as the default one.'
            };
        case 'turn-unreachable':
            return {
                problem: 'No relay (TURN) server answers, so a device behind a strict NAT or firewall cannot connect.',
                fix: 'Let this machine reach the relay on UDP 3478 and TCP 3478 or 5349 through its firewall.'
            };
        case 'turn-refused':
            return {
                problem:
                    'The relay (TURN) server answers but does not take the credentials the broker gave, so a device behind a strict NAT or firewall cannot connect.',
                fix: 'Whoever runs the broker has to give it the secret its relay expects; on the default broker, try again later.'
            };
        case 'udp-blocked':
            return {
                problem: 'UDP is blocked on this network, so every connection goes through the relay over TCP, which is slower.',
                fix: 'Allow outgoing UDP on this network, at least to port 3478.'
            };
        case 'vpn-blocks-udp':
            return {
                problem: `Traffic leaves through ${facts.tunnel ?? 'a VPN'}, a VPN or exit node that drops UDP, so connections ${works(facts.probes.filter((probe) => probe.transport !== 'udp')) ? 'only work through the relay over TCP' : 'fail'}.`,
                fix: 'Let Ruimte bypass the VPN (split tunneling), turn off the exit node, or allow UDP through it.'
            };
        case 'blocked':
            return {
                problem: 'Neither UDP nor the relay over TCP gets out of this network, so other devices cannot connect.',
                fix: 'Check the firewall or proxy of this network. It has to let out UDP, or TCP to the relay on 3478 or 5349.'
            };
        case 'lan-door-down':
            return {
                problem: `The machine is not listening on the local network${facts.lanDoor.port === null ? '' : ` because port ${facts.lanDoor.port} is taken`}, so devices on this network go through the broker.`,
                fix: 'Stop what holds the port, or start Ruimte with another --lan-port.'
            };
        default:
            return { problem: `The check says ${cause}, which this version does not know.`, fix: null };
    }
}
