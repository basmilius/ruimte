/*
 * `ruimte context`, reached through the `ruimte-context` script on every session's PATH. Reads
 * what the person linked to this agent on the canvas, with the address and the token from the
 * environment the daemon gave the session.
 *
 *   ruimte-context            lists the linked sources
 *   ruimte-context read <id>  prints one of them
 */
export const runContext = async (args: string[], env: Record<string, string | undefined> = process.env): Promise<number> => {
    const url = env.RUIMTE_CONTEXT_URL;
    const token = env.RUIMTE_CONTEXT_TOKEN ?? env.RUIMTE_HOOK_TOKEN;
    if (!url || !token) {
        console.error('Not inside a Ruimte session: RUIMTE_CONTEXT_URL and a token are missing.');
        return 2;
    }

    const [command = 'list', id] = args;
    const headers = { authorization: `Bearer ${token}` };

    if (command === 'list') {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            console.error(`The daemon answered ${response.status}`);
            return 1;
        }
        const { sources } = (await response.json()) as { sources: Array<{ id: string; kind: string; title: string }> };
        if (sources.length === 0) {
            console.log('Nothing is linked to this session.');
        }
        for (const source of sources) {
            console.log(`${source.id}\t${source.kind}\t${source.title}`);
        }
        return 0;
    }

    if (command === 'read' && id) {
        const response = await fetch(`${url}/${encodeURIComponent(id)}`, { headers });
        if (!response.ok) {
            console.error(response.status === 404 ? `No linked source ${id}` : `The daemon answered ${response.status}`);
            return 1;
        }
        process.stdout.write(`${await response.text()}\n`);
        return 0;
    }

    console.error('Usage: ruimte-context [list | read <id>]');
    return 1;
};
