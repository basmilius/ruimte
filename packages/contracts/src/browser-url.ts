/* Adds a scheme when the person typed a bare host: `http` for localhost and an IPv4 address, `https` otherwise. A scheme that is there stays. */
export function normalizeUrl(input: string): string {
    const trimmed = input.trim();
    if (trimmed === '') {
        return 'about:blank';
    }
    if (/^localhost(:\d+)?(\/|$)/.test(trimmed) || /^\d+\.\d+\.\d+\.\d+/.test(trimmed)) {
        return `http://${trimmed}`;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
        return trimmed;
    }
    return `https://${trimmed}`;
}

/*
 * Why an address is no page an agent may open: it does not parse, or it is not HTTP or HTTPS. The blank page
 * is fine. A person's address bar is not held to this; the shell's guards decide what a guest may load.
 */
export function agentAddressProblem(url: string): 'invalid' | 'scheme' | null {
    if (url === 'about:blank') {
        return null;
    }
    let protocol: string;
    try {
        protocol = new URL(url).protocol;
    } catch {
        return 'invalid';
    }
    return protocol === 'http:' || protocol === 'https:' ? null : 'scheme';
}
