import { describe, expect, test } from 'bun:test';
import { ipv6Groups, isLocalAddress, ownAddresses, translatedIpv4, tunneledIpv4 } from './local-address.ts';

const NONE: string[] = [];

function local(address: string, own: readonly string[] = NONE): boolean {
    return isLocalAddress(address, own);
}

describe('ipv6Groups', () => {
    test('expands a compressed address and takes in a dotted IPv4 tail', () => {
        expect(ipv6Groups('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(ipv6Groups('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
        expect(ipv6Groups('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
        expect(ipv6Groups('::1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0, 0x102, 0x304]);
        expect(ipv6Groups('1:2:3:4:5:6:7.8.9.10')).toEqual([1, 2, 3, 4, 5, 6, 0x708, 0x90a]);
        expect(ipv6Groups('fe80::1:2')).toEqual([0xfe80, 0, 0, 0, 0, 0, 1, 2]);
    });

    test('answers null for what is no IPv6 address', () => {
        expect(ipv6Groups('1::2::3')).toBeNull();
        expect(ipv6Groups('1:2:3')).toBeNull();
        expect(ipv6Groups('::ffff:300.0.0.1')).toBeNull();
        expect(ipv6Groups('g::1')).toBeNull();
    });
});

describe('embedded IPv4 addresses', () => {
    test('a mapped and a well-known NAT64 address stand for one IPv4 address', () => {
        expect(translatedIpv4(ipv6Groups('::ffff:10.1.2.3')!)).toBe('10.1.2.3');
        expect(translatedIpv4(ipv6Groups('64:ff9b::c0a8:101')!)).toBe('192.168.1.1');
        expect(translatedIpv4(ipv6Groups('2606:4700::1')!)).toBeNull();
    });

    test('6to4 carries its router and Teredo its server and its inverted client', () => {
        expect(tunneledIpv4(ipv6Groups('2002:7f00:1::')!)).toEqual(['127.0.0.1']);
        // Server 65.54.227.120, client 192.168.1.10 inverted into the last 32 bits.
        expect(tunneledIpv4(ipv6Groups('2001:0:4136:e378:8000:63bf:3f57:fef5')!)).toEqual(['65.54.227.120', '192.168.1.10']);
    });
});

describe('isLocalAddress', () => {
    test('every local IPv4 range', () => {
        const addresses = [
            '0.0.0.0',
            '0.1.2.3',
            '10.0.0.1',
            '100.64.0.1',
            '100.127.255.254',
            '127.0.0.1',
            '127.255.255.254',
            '169.254.169.254',
            '172.16.0.1',
            '172.31.255.255',
            '192.0.0.170',
            '192.0.2.1',
            '192.88.99.1',
            '192.168.1.1',
            '198.18.0.1',
            '198.19.255.255',
            '198.51.100.7',
            '203.0.113.9',
            '224.0.0.251',
            '239.255.255.250',
            '240.0.0.1',
            '255.255.255.255'
        ];
        expect(addresses.filter((address) => !local(address))).toEqual([]);
    });

    test('public IPv4 addresses next to those ranges', () => {
        const addresses = [
            '1.1.1.1',
            '8.8.8.8',
            '100.63.255.255',
            '100.128.0.0',
            '172.15.255.255',
            '172.32.0.0',
            '192.0.3.1',
            '198.17.255.255',
            '223.255.255.255'
        ];
        expect(addresses.filter((address) => local(address))).toEqual([]);
    });

    test('every local IPv6 range, outside global unicast and inside it', () => {
        const addresses = [
            '::',
            '::1',
            '::127.0.0.1',
            '::ffff:0:8.8.8.8',
            '100::1',
            'fc00::1',
            'fd12:3456::1',
            'fe80::1',
            'fe80::1%en0',
            'fec0::1',
            'ff02::1',
            '64:ff9b:1::808:808',
            '2001:2::1',
            '2001:10::1',
            '2001:db8::1',
            '3fff::1',
            '4000::1',
            '[::1]'
        ];
        expect(addresses.filter((address) => !local(address))).toEqual([]);
    });

    test('mapped and NAT64 addresses are as local as the IPv4 address they carry', () => {
        expect(local('::ffff:127.0.0.1')).toBe(true);
        expect(local('::ffff:7f00:1')).toBe(true);
        expect(local('::ffff:192.168.0.10')).toBe(true);
        expect(local('64:ff9b::7f00:1')).toBe(true);
        expect(local('64:ff9b::10.0.0.1')).toBe(true);
        expect(local('::ffff:8.8.8.8')).toBe(false);
        expect(local('64:ff9b::808:808')).toBe(false);
    });

    test('6to4 and Teredo are local when either IPv4 end is', () => {
        expect(local('2002:c0a8:101::1')).toBe(true);
        expect(local('2002:7f00:1::1')).toBe(true);
        expect(local('2001:0:4136:e378:8000:63bf:3f57:fef5')).toBe(true);
        // Server 127.0.0.1.
        expect(local('2001:0:7f00:1:8000:63bf:f7f7:f7f7')).toBe(true);
        // Both ends public: 65.54.227.120 and 8.8.8.8.
        expect(local('2001:0:4136:e378:8000:63bf:f7f7:f7f7')).toBe(false);
        expect(local('2002:808:808::1')).toBe(false);
    });

    test('public IPv6 addresses', () => {
        expect(local('2606:4700:4700::1111')).toBe(false);
        expect(local('2a00:1450:4001:80b::200e')).toBe(false);
    });

    test("this machine's own addresses, public ones included, in any spelling", () => {
        const own = ['93.184.216.34', '2a01:4f8:1:2::3', 'fe80::1%en0'];
        expect(local('93.184.216.34', own)).toBe(true);
        expect(local('::ffff:93.184.216.34', own)).toBe(true);
        expect(local('64:ff9b::5db8:d822', own)).toBe(true);
        expect(local('2a01:04f8:0001:0002:0000:0000:0000:0003', own)).toBe(true);
        expect(local('2002:5db8:d822::1', own)).toBe(true);
        expect(local('93.184.216.35', own)).toBe(false);
    });

    test('reads the interfaces of this machine when it is given none', () => {
        const mine = ownAddresses();
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.every((address) => isLocalAddress(address))).toBe(true);
    });

    test('what is no address at all counts as local', () => {
        expect(local('localhost')).toBe(true);
        expect(local('example.com')).toBe(true);
        expect(local('')).toBe(true);
        expect(local('127.1')).toBe(true);
    });
});
