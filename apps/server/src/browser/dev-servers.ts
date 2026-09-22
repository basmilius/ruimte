import type { DevServer } from '@ruimte/contracts';

/* As much of `fetch` as a probe uses, so a test can hand it an answer. */
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/* A local port answers at once or not at all, and the splash asks again a few seconds later. */
const PROBE_TIMEOUT_MS = 700;

/* Enough of an index page to hold its <title>; the rest of the body is dropped. */
const TITLE_BYTES = 16 * 1024;

const TITLE_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

export const titleOfHtml = (html: string): string | undefined => {
    const match = TITLE_PATTERN.exec(html);
    if (match === null) {
        return undefined;
    }
    const text = match[1]
        .replace(/&(amp|lt|gt|quot|apos|#39);/g, (whole, name: string) => ENTITIES[name] ?? whole)
        .replace(/\s+/g, ' ')
        .trim();
    return text === '' ? undefined : text.slice(0, 200);
};

const readStart = async (response: Response): Promise<string> => {
    const body = response.body;
    if (body === null) {
        return '';
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    try {
        while (html.length < TITLE_BYTES) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            html += decoder.decode(value, { stream: true });
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    return html;
};

const probePort = async (port: number, request: Fetch): Promise<DevServer | null> => {
    try {
        // 127.0.0.1 rather than localhost: a resolver that answers ::1 first would call a server
        // bound to IPv4 down. A redirect is an answer as well, and following one could leave the machine.
        const response = await request(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        if (!(response.headers.get('content-type') ?? '').includes('text/html')) {
            await response.body?.cancel().catch(() => undefined);
            return { port };
        }
        const title = titleOfHtml(await readStart(response));
        return title === undefined ? { port } : { port, title };
    } catch {
        return null;
    }
};

/*
 * Which of the given ports have a web server on them, asked over HTTP rather than as a bare
 * connection: a page with a name is worth more on the splash than an open socket, and a port that
 * answers something other than HTTP is not one a browser node can open anyway.
 */
export const probeDevServers = async (ports: readonly number[], request: Fetch = fetch): Promise<DevServer[]> => {
    const answers = await Promise.all(ports.map((port) => probePort(port, request)));
    return answers.filter((server): server is DevServer => server !== null).sort((one, other) => one.port - other.port);
};
