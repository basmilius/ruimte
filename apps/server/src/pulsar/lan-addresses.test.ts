import { describe, expect, test } from 'bun:test';
import type { NetworkInterfaceInfo } from 'node:os';
import { lanAddresses } from './lan-addresses.ts';

const ipv4 = (address: string, internal = false): NetworkInterfaceInfo => ({
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`
});

const ipv6 = (address: string): NetworkInterfaceInfo => ({
    address,
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: `${address}/64`,
    scopeid: 0
});

describe('lanAddresses', () => {
    test('the local network first, then a tailnet, and nothing a client elsewhere cannot reach', () => {
        expect(
            lanAddresses({
                lo0: [ipv4('127.0.0.1', true)],
                utun4: [ipv4('100.101.102.103')],
                en0: [ipv4('192.168.1.20'), ipv6('fd00::20')],
                en1: [ipv4('10.0.0.5'), ipv4('169.254.10.10')],
                en2: [ipv4('172.20.0.4'), ipv4('172.32.0.4'), ipv4('203.0.113.9')],
                docker0: [ipv4('172.17.0.1')],
                'br-3f2a': [ipv4('172.18.0.1')],
                bridge100: [ipv4('192.168.64.1')],
                vethab12: [ipv4('10.1.0.1')]
            })
        ).toEqual(['192.168.1.20', '10.0.0.5', '172.20.0.4', '100.101.102.103']);
    });

    test('one address on two interfaces is tried once, and a machine without a network has none', () => {
        expect(lanAddresses({ en0: [ipv4('192.168.1.20')], en5: [ipv4('192.168.1.20')] })).toEqual(['192.168.1.20']);
        expect(lanAddresses({ lo0: [ipv4('127.0.0.1', true)] })).toEqual([]);
    });
});
