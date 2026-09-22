import { describe, expect, it } from 'bun:test';
import { probeDevServers, titleOfHtml } from './dev-servers.ts';

const page = (html: string): Response => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('titleOfHtml', () => {
    it('reads the title of a page', () => {
        expect(titleOfHtml('<!doctype html><html><head><title>ruimte</title></head>')).toBe('ruimte');
    });

    it('folds whitespace and decodes the entities a title can carry', () => {
        expect(titleOfHtml('<title>\n  Bas &amp;\tCo  \n</title>')).toBe('Bas & Co');
    });

    it('reads a title with attributes on the tag', () => {
        expect(titleOfHtml('<title data-hydrate="1">Vite App</title>')).toBe('Vite App');
    });

    it('has nothing to say about a page without a title or with an empty one', () => {
        expect(titleOfHtml('<html><body>hello</body></html>')).toBeUndefined();
        expect(titleOfHtml('<title>   </title>')).toBeUndefined();
    });
});

describe('probeDevServers', () => {
    it('reports the ports that answered, by port, with the name of the page', async () => {
        const answers: Record<number, Response> = {
            5173: page('<title>ruimte</title>'),
            3000: page('<title>Next</title>')
        };
        const servers = await probeDevServers([5173, 3000, 8080], async (input) => {
            const port = Number(new URL(input).port);
            const answer = answers[port];
            if (!answer) {
                throw new Error('connection refused');
            }
            return answer;
        });
        expect(servers).toEqual([
            { port: 3000, title: 'Next' },
            { port: 5173, title: 'ruimte' }
        ]);
    });

    it('keeps a port that answers something other than a page, without a name', async () => {
        const servers = await probeDevServers([8000], async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
        expect(servers).toEqual([{ port: 8000 }]);
    });

    it('asks the loopback address itself, so a server on IPv4 is found', async () => {
        const asked: string[] = [];
        await probeDevServers([4321], async (input) => {
            asked.push(input);
            throw new Error('connection refused');
        });
        expect(asked).toEqual(['http://127.0.0.1:4321/']);
    });
});
