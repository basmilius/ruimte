import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

// The bridges of containers, virtual machines and Internet Sharing; nothing elsewhere on the network reaches those.
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|cni|flannel|lxc|lxd|podman|bridge)/;

// More than a machine has interfaces worth trying; a client tries every one at once.
const MAX_ADDRESSES = 16;

const isPrivate = (first: number, second: number): boolean =>
    first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);

// 100.64.0.0/10, which Tailscale and other mesh networks hand out, so a machine on the same tailnet is found as well.
const isSharedAddressSpace = (first: number, second: number): boolean => first === 100 && second >= 64 && second <= 127;

/*
 * The IPv4 addresses a client on the same network or the same tailnet may reach this machine at, the
 * local network first. Read when asked, so a new address after a network change needs no timer. IPv6
 * stays out: the door listens on IPv4 only.
 */
export const lanAddresses = (interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] => {
    const local: string[] = [];
    const mesh: string[] = [];
    for (const [name, entries] of Object.entries(interfaces)) {
        if (VIRTUAL_INTERFACE.test(name)) {
            continue;
        }
        for (const entry of entries ?? []) {
            if (entry.family !== 'IPv4' || entry.internal) {
                continue;
            }
            const [first = 0, second = 0] = entry.address.split('.').map(Number);
            if (isPrivate(first, second)) {
                local.push(entry.address);
            } else if (isSharedAddressSpace(first, second)) {
                mesh.push(entry.address);
            }
        }
    }
    return [...new Set([...local, ...mesh])].slice(0, MAX_ADDRESSES);
};
