import { isIPv4, isIPv6 } from 'node:net';

/*
 * Cloudflare's published ranges, from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
 * (checked 2026-09-15). They change rarely; a range missing here only means a client behind that edge
 * is counted against the edge's address, never that a header is believed from someone else.
 */
export const CLOUDFLARE_RANGES = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32'
] as const;

const ipv4Bits = (address: string): bigint => address.split('.').reduce((bits, part) => (bits << 8n) | BigInt(Number(part)), 0n);

const ipv6Bits = (address: string): bigint => {
    let text = address;
    // A trailing dotted quad (`::ffff:1.2.3.4`) is two groups written the IPv4 way.
    const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
        const bits = ipv4Bits(dotted[1]!);
        text = `${text.slice(0, -dotted[1]!.length)}${(bits >> 16n).toString(16)}:${(bits & 0xffffn).toString(16)}`;
    }
    const [head = '', tail] = text.split('::');
    const headGroups = head === '' ? [] : head.split(':');
    const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
    const groups = tail === undefined ? headGroups : [...headGroups, ...new Array<string>(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups];
    return groups.reduce((bits, group) => (bits << 16n) | BigInt(parseInt(group, 16)), 0n);
};

interface Range {
    family: 4 | 6;
    network: bigint;
    mask: bigint;
}

const rangeOf = (cidr: string): Range => {
    const [address = '', prefixText = ''] = cidr.split('/');
    const family = isIPv4(address) ? 4 : 6;
    const width = family === 4 ? 32n : 128n;
    const prefix = BigInt(Number(prefixText));
    const mask = ((1n << prefix) - 1n) << (width - prefix);
    const bits = family === 4 ? ipv4Bits(address) : ipv6Bits(address);
    return { family, network: bits & mask, mask };
};

const RANGES = CLOUDFLARE_RANGES.map(rangeOf);

/* Whether an address belongs to Cloudflare's edge; an IPv4-mapped IPv6 address counts as its IPv4 half. */
export const isCloudflareAddress = (address: string): boolean => {
    const plain = address.startsWith('::ffff:') && isIPv4(address.slice('::ffff:'.length)) ? address.slice('::ffff:'.length) : address;
    if (isIPv4(plain)) {
        const bits = ipv4Bits(plain);
        return RANGES.some((range) => range.family === 4 && (bits & range.mask) === range.network);
    }
    if (isIPv6(plain)) {
        const bits = ipv6Bits(plain);
        return RANGES.some((range) => range.family === 6 && (bits & range.mask) === range.network);
    }
    return false;
};
