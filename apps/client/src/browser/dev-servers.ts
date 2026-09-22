import type { DevServer } from '@ruimte/contracts';

interface KnownPort {
    port: number;
    /* Product names, so they stay out of the translations. */
    tools: readonly string[];
}

/* The ports a dev server listens on by default. The splash asks the machine which of these answer. */
export const DEV_SERVER_PORTS: readonly KnownPort[] = [
    { port: 5173, tools: ['Vite', 'SvelteKit'] },
    { port: 5174, tools: ['Vite'] },
    { port: 3000, tools: ['Next.js', 'Nuxt', 'Rails'] },
    { port: 4321, tools: ['Astro'] },
    { port: 4200, tools: ['Angular'] },
    { port: 4173, tools: ['Vite preview'] },
    { port: 6006, tools: ['Storybook'] },
    { port: 8000, tools: ['Django', 'Laravel'] },
    { port: 8080, tools: ['webpack', 'Tomcat'] },
    { port: 8081, tools: ['Metro', 'Expo'] },
    { port: 4000, tools: ['Phoenix', 'Jekyll'] },
    { port: 5000, tools: ['Flask', 'ASP.NET'] },
    { port: 1313, tools: ['Hugo'] },
    { port: 8888, tools: ['Jupyter'] }
];

export const DEV_SERVER_PROBE_PORTS: number[] = DEV_SERVER_PORTS.map((entry) => entry.port);

export interface DevServerTile {
    port: number;
    url: string;
    /* The page's own name where it gave one, the tools that pick the port otherwise. */
    detail?: string;
    running: boolean;
}

/* A page is opened by the name a person types, not by the address a probe used. */
const urlOf = (port: number): string => `http://localhost:${port}`;

/*
 * What the splash offers: the servers that answered, by port, and then the ports nobody is on yet,
 * in the order of the table. The dead ones stay on screen because a person often starts the server
 * after opening the node, and the tile is where they come back to.
 */
export const devServerTiles = (running: readonly DevServer[], known: readonly KnownPort[] = DEV_SERVER_PORTS): DevServerTile[] => {
    const tools = new Map(known.map((entry) => [entry.port, entry.tools.join(', ')]));
    const live = [...running]
        .sort((one, other) => one.port - other.port)
        .map((server): DevServerTile => ({ port: server.port, url: urlOf(server.port), detail: server.title ?? tools.get(server.port), running: true }));
    const up = new Set(running.map((server) => server.port));
    const rest = known
        .filter((entry) => !up.has(entry.port))
        .map((entry): DevServerTile => ({ port: entry.port, url: urlOf(entry.port), detail: tools.get(entry.port), running: false }));
    return [...live, ...rest];
};
