// The interfaces VPNs and mesh networks bring up; the default route leaving through one is a tunnel or an exit node.
const TUNNEL_INTERFACE = /^(utun|tun|tap|wg|ppp|ipsec|tailscale|zt|nordlynx|gpd|vpn|proton|mullvad)/i;

/* The interface named in `route -n get default` (macOS) or `ip route show default` (Linux); null when neither names one. */
export function defaultRouteInterface(output: string): string | null {
    const mac = /^\s*interface:\s*(\S+)/m.exec(output);
    if (mac !== null) {
        return mac[1]!;
    }
    const linux = /^default\b.*?\bdev\s+(\S+)/m.exec(output);
    return linux === null ? null : linux[1]!;
}

export function isTunnelInterface(name: string): boolean {
    return TUNNEL_INTERFACE.test(name);
}

export function routeCommand(platform: NodeJS.Platform): string[] | null {
    switch (platform) {
        case 'darwin':
            return ['/sbin/route', '-n', 'get', 'default'];
        case 'linux':
            return ['ip', 'route', 'show', 'default'];
        default:
            return null;
    }
}

/*
 * The tunnel the default route leaves by, read from the routing table and nothing else, so it needs no
 * credentials and no VPN's own tool. Null when traffic leaves by an ordinary interface or the table
 * cannot be read.
 */
export async function readTunnel(platform: NodeJS.Platform = process.platform): Promise<string | null> {
    const command = routeCommand(platform);
    if (command === null) {
        return null;
    }
    try {
        const child = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
        const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        if (code !== 0) {
            return null;
        }
        const name = defaultRouteInterface(output);
        return name !== null && isTunnelInterface(name) ? name : null;
    } catch {
        return null;
    }
}
