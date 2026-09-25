import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { parseHTML } from 'linkedom';

export interface AppleWebResponse {
    url: string;
    status: number;
    contentType: string;
    text: string;
}

export type AppleWebRequest = (url: URL, signal: AbortSignal, headers?: Record<string, string>) => Promise<AppleWebResponse>;

const blocked = new BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
] as const) {
    blocked.addSubnet(address, prefix, 'ipv4');
}
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2001::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

export const isPublicWebAddress = (address: string): boolean => {
    const family = isIP(address);
    if (family === 4) {
        return !blocked.check(address, 'ipv4');
    }
    return family === 6 && publicV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
};

export const publicWebUrl = (value: string): URL => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Use an HTTP or HTTPS URL without embedded credentials.');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!host.includes('.') && !isIP(host)) {
        throw new Error('Only public internet pages are available.');
    }
    if (isIP(host) && !isPublicWebAddress(host)) {
        throw new Error('Private, loopback, and reserved network addresses are unavailable.');
    }
    return url;
};

export const requestPublicWeb: AppleWebRequest = async (initial, signal, headers = {}) => {
    let url = publicWebUrl(initial.href);
    for (let redirect = 0; redirect <= 5; redirect++) {
        signal.throwIfAborted();
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
        signal.throwIfAborted();
        if (addresses.length === 0 || addresses.some((entry) => !isPublicWebAddress(entry.address))) {
            throw new Error('The page resolves to a private or reserved network address.');
        }
        // Connect to the checked address, keeping TLS verification and Host tied to the original URL.
        const response = await new Promise<{ status: number; contentType: string; location?: string; text: string }>((resolve, reject) => {
            const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
                {
                    hostname: addresses[0]!.address,
                    port: url.port || (url.protocol === 'https:' ? 443 : 80),
                    ...(url.protocol === 'https:' && !isIP(host) ? { servername: host } : {}),
                    path: `${url.pathname}${url.search}`,
                    method: 'GET',
                    signal,
                    headers: { 'user-agent': 'Ruimte/AppleFoundationModels', accept: 'text/html, text/plain, application/json', ...headers, host: url.host }
                },
                (incoming) => {
                    const status = incoming.statusCode ?? 0;
                    if (status >= 300 && status < 400 && incoming.headers.location) {
                        resolve({ status, contentType: '', location: incoming.headers.location, text: '' });
                        incoming.destroy();
                        return;
                    }
                    const chunks: Buffer[] = [];
                    let size = 0;
                    incoming.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > 2 * 1024 * 1024) {
                            incoming.destroy(new Error('The page exceeds the 2 MiB download limit.'));
                        } else {
                            chunks.push(chunk);
                        }
                    });
                    incoming.on('error', reject);
                    incoming.on('end', () =>
                        resolve({
                            status,
                            contentType: incoming.headers['content-type'] ?? '',
                            text: Buffer.concat(chunks).toString('utf8')
                        })
                    );
                }
            );
            request.on('error', reject);
            request.end();
        });
        if (response.location) {
            const next = publicWebUrl(new URL(response.location, url).href);
            if (next.origin !== url.origin && Object.keys(headers).length > 0) {
                throw new Error('A search service redirect to another origin was refused.');
            }
            url = next;
            continue;
        }
        return { url: url.href, ...response };
    }
    throw new Error('The page redirected more than five times.');
};

export const limitAppleText = (text: string, bytes = 5200): { text: string; truncated: boolean } => {
    const buffer = Buffer.from(text);
    if (buffer.length <= bytes) {
        return { text, truncated: false };
    }
    let end = bytes;
    while (end > 0 && (buffer[end]! & 0xc0) === 0x80) {
        end--;
    }
    return { text: buffer.subarray(0, end).toString('utf8'), truncated: true };
};

export const extractApplePage = (page: AppleWebResponse): { title: string; text: string } => {
    if (page.status < 200 || page.status >= 300) {
        throw new Error(`The page returned HTTP ${page.status}.`);
    }
    if (/text\/html|application\/xhtml\+xml/i.test(page.contentType)) {
        const { document } = parseHTML(page.text);
        const title = document.querySelector('title')?.textContent?.trim() ?? '';
        for (const element of document.querySelectorAll('script,style,noscript,template,svg,nav,footer,form,[hidden],[aria-hidden="true"]')) {
            element.remove();
        }
        for (const element of document.querySelectorAll('p,div,li,br,h1,h2,h3,h4,pre,tr')) {
            element.appendChild(document.createTextNode('\n'));
        }
        const body = document.querySelector('main,article') ?? document.body;
        const text = (body?.textContent || document.documentElement?.textContent || '')
            .replace(/[\t ]+/g, ' ')
            .replace(/\n\s*\n/g, '\n\n')
            .trim();
        return { title, text };
    }
    if (!/^(text\/|application\/(json|xml))/i.test(page.contentType)) {
        throw new Error('Only text, HTML, JSON, and XML pages are supported.');
    }
    return { title: '', text: page.text.trim() };
};
