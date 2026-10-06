import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

/*
 * Whether an address is one a visual's page must never reach: this machine, its local networks, or
 * anything not routed on the public internet. Every check reads what the interfaces hold at that
 * moment, so an address a network change gave the machine counts at once.
 */

const LOCAL_IPV4: ReadonlyArray<readonly [string, number]> = [
    // This network, with the unspecified address.
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    // Carrier-grade NAT.
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    // IETF protocol assignments, with the NAT64 discovery and DS-Lite addresses.
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    // The deprecated 6to4 relay anycast.
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    // Benchmarking.
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    // Reserved, with the broadcast address at its end.
    ['240.0.0.0', 4]
];

/* Inside global unicast (`2000::/3`), the only part of IPv6 routed publicly; everything outside it is local already. */
const LOCAL_IPV6: ReadonlyArray<readonly [string, number]> = [
    // Benchmarking.
    ['2001:2::', 48],
    // The deprecated ORCHID range.
    ['2001:10::', 28],
    ['2001:db8::', 32],
    ['3fff::', 20]
];

const ranges = new BlockList();
for (const [network, prefix] of LOCAL_IPV4) {
    ranges.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of LOCAL_IPV6) {
    ranges.addSubnet(network, prefix, 'ipv6');
}

const globalUnicast = new BlockList();
globalUnicast.addSubnet('2000::', 3, 'ipv6');

/* The addresses the interfaces of this machine hold right now, public ones included. */
export function ownAddresses(): string[] {
    return Object.values(networkInterfaces()).flatMap((entries) => (entries ?? []).map((entry) => entry.address));
}

/* An IPv6 address as its eight 16-bit groups, a trailing dotted IPv4 part included; null when it does not parse. */
export function ipv6Groups(address: string): number[] | null {
    let text = address.toLowerCase();
    const tail: number[] = [];
    const dotted = /(^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
    if (dotted) {
        const octets = dotted[2]!.split('.').map(Number);
        if (octets.some((octet) => octet > 255)) {
            return null;
        }
        tail.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        text = text.slice(0, dotted.index + dotted[1]!.length);
        if (text.endsWith(':') && !text.endsWith('::')) {
            text = text.slice(0, -1);
        }
    }
    const halves = text.split('::');
    if (halves.length > 2) {
        return null;
    }
    const parse = (part: string): number[] | null => {
        if (part === '') {
            return [];
        }
        const groups = part.split(':');
        return groups.every((group) => /^[0-9a-f]{1,4}$/.test(group)) ? groups.map((group) => parseInt(group, 16)) : null;
    };
    const head = parse(halves[0]!);
    const rest = halves.length === 2 ? parse(halves[1]!) : [];
    if (head === null || rest === null) {
        return null;
    }
    const written = head.length + rest.length + tail.length;
    if (halves.length === 1) {
        return written === 8 ? [...head, ...tail] : null;
    }
    return written > 7 ? null : [...head, ...new Array<number>(8 - written).fill(0), ...rest, ...tail];
}

function ipv4Of(high: number, low: number): string {
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/* The IPv4 address a mapped or a well-known NAT64 address stands for, which is all it reaches. */
export function translatedIpv4(groups: readonly number[]): string | null {
    const zeroFrom = (from: number, to: number): boolean => groups.slice(from, to).every((group) => group === 0);
    if (zeroFrom(0, 5) && groups[5] === 0xffff) {
        return ipv4Of(groups[6]!, groups[7]!);
    }
    if (groups[0] === 0x64 && groups[1] === 0xff9b && zeroFrom(2, 6)) {
        return ipv4Of(groups[6]!, groups[7]!);
    }
    return null;
}

/* The IPv4 addresses a 6to4 or Teredo address tunnels to: the 6to4 router, or the Teredo server and its client (stored inverted). */
export function tunneledIpv4(groups: readonly number[]): string[] {
    if (groups[0] === 0x2002) {
        return [ipv4Of(groups[1]!, groups[2]!)];
    }
    if (groups[0] === 0x2001 && groups[1] === 0) {
        return [ipv4Of(groups[2]!, groups[3]!), ipv4Of(groups[6]! ^ 0xffff, groups[7]! ^ 0xffff)];
    }
    return [];
}

function isOwn(address: string, family: 'ipv4' | 'ipv6', own: readonly string[]): boolean {
    const list = new BlockList();
    for (const candidate of own) {
        const bare = candidate.replace(/%.*$/, '');
        const kind = isIP(bare);
        if (kind !== 0) {
            list.addAddress(bare, kind === 4 ? 'ipv4' : 'ipv6');
        }
    }
    return list.check(address, family);
}

/*
 * True for every address that is not public somewhere else: what does not parse, the ranges above,
 * IPv6 outside global unicast, an address that translates or tunnels to a local IPv4 address, and
 * every address `own` holds.
 */
export function isLocalAddress(address: string, own: readonly string[] = ownAddresses()): boolean {
    const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    const kind = isIP(bare);
    if (kind === 4) {
        return ranges.check(bare, 'ipv4') || isOwn(bare, 'ipv4', own);
    }
    const groups = kind === 6 ? ipv6Groups(bare) : null;
    if (groups === null) {
        return true;
    }
    if (isOwn(bare, 'ipv6', own)) {
        return true;
    }
    // The local-use NAT64 prefix puts the IPv4 part where its operator chose, and is never public.
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) {
        return true;
    }
    const translated = translatedIpv4(groups);
    if (translated !== null) {
        return isLocalAddress(translated, own);
    }
    if (tunneledIpv4(groups).some((inner) => isLocalAddress(inner, own))) {
        return true;
    }
    return !globalUnicast.check(bare, 'ipv6') || ranges.check(bare, 'ipv6');
}
