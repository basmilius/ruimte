/*
 * `ruimte context`, reached through the `ruimte-context` script on every session's PATH. Reads
 * what the person linked to this agent on the canvas, and changes the canvas through the verbs the
 * daemon knows, with the address and the token from the environment the daemon gave the session.
 *
 *   ruimte-context              lists the linked sources
 *   ruimte-context read <id>    prints one of them
 *   ruimte-context help         lists the canvas verbs
 *   ruimte-context <verb> ...   runs one; the daemon parses the arguments
 *
 * Exit codes: 0 done, 1 the daemon could not be reached or failed, 2 not inside a session, 3 the
 * daemon refused (an unknown verb, bad arguments, or a rule of the project).
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

    if (command === 'read') {
        if (!id) {
            console.error('Usage: ruimte-context [list | read <id> | help | <verb> ...]');
            return 1;
        }
        const response = await fetch(`${url}/${encodeURIComponent(id)}`, { headers });
        if (!response.ok) {
            console.error(response.status === 404 ? `No linked source ${id}` : `The daemon answered ${response.status}`);
            return 1;
        }
        process.stdout.write(`${await response.text()}\n`);
        return 0;
    }

    return runVerb(url.replace(/\/context\/?$/, '/canvas'), command, args.slice(1), headers);
};

const runVerb = async (canvasUrl: string, verb: string, argv: string[], headers: Record<string, string>): Promise<number> => {
    let response: Response;
    let body: string;
    try {
        response = await fetch(`${canvasUrl}/${encodeURIComponent(verb)}`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ argv })
        });
        body = await response.text();
    } catch (e) {
        console.error(`Could not reach the daemon: ${e instanceof Error ? e.message : 'unknown error'}`);
        return 1;
    }
    if (response.ok) {
        process.stdout.write(body);
        return 0;
    }
    // 404 is a verb this daemon does not have, which is the same kind of no as bad arguments.
    if (response.status === 422 || response.status === 404) {
        process.stderr.write(body);
        return 3;
    }
    console.error(`The daemon answered ${response.status}${body ? `: ${body.trim()}` : ''}`);
    return 1;
};
