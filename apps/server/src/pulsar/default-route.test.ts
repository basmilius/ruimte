import { describe, expect, test } from 'bun:test';
import { defaultRouteInterface, isTunnelInterface } from './default-route.ts';

describe('the default route', () => {
    test('names its interface on macOS and on Linux', () => {
        expect(defaultRouteInterface('   route to: default\ndestination: default\n    gateway: 192.168.1.1\n  interface: en0\n      flags: <UP>\n')).toBe(
            'en0'
        );
        expect(defaultRouteInterface('default via 10.0.0.1 dev wg0 proto static\n')).toBe('wg0');
        expect(defaultRouteInterface('')).toBeNull();
    });

    test('a VPN or mesh interface is a tunnel, an ordinary one is not', () => {
        expect(['utun4', 'wg0', 'tailscale0', 'tun0', 'ppp0'].every(isTunnelInterface)).toBe(true);
        expect(['en0', 'eth0', 'wlan0', 'enp3s0'].some(isTunnelInterface)).toBe(false);
    });
});
