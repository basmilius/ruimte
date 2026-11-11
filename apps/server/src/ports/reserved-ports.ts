/*
 * Ruimte's own ports, which a Tunnels row may not name. The daemon, the door on the local
 * network and the external listener sit at fixed offsets, so a dev daemon beside an installed one (4211 beside 4210) is
 * covered whichever of the two this daemon is. The proxies Ruimte starts on a port the system picked are
 * reserved while they run.
 */
const FAMILY = [4210, 4211, 4212, 4213];
const OFFSETS = [0, 10, 20];

export const WELL_KNOWN_RUIMTE_PORTS: readonly number[] = OFFSETS.flatMap((offset) => FAMILY.map((port) => port + offset));

class ReservedPorts {
    private readonly held = new Map<number, number>();

    /* Reserves a port until the returned function is called; the same port reserved twice is held until both are released. */
    reserve(port: number): () => void {
        this.held.set(port, (this.held.get(port) ?? 0) + 1);
        let released = false;

        return () => {
            if (released) {
                return;
            }

            released = true;

            const left = (this.held.get(port) ?? 1) - 1;

            if (left <= 0) {
                this.held.delete(port);
            } else {
                this.held.set(port, left);
            }
        };
    }

    list(): number[] {
        return [...this.held.keys()];
    }
}

/* One per process, since the proxies that reserve a port are started far from the code that checks it. */
export const reservedPorts = new ReservedPorts();

/* The ports a row may not name: those the daemon itself listens on, the well-known ones and those reserved now. */
export function deniedRuimtePorts(own: readonly number[]): number[] {
    return [...new Set([...own, ...WELL_KNOWN_RUIMTE_PORTS, ...reservedPorts.list()])];
}
