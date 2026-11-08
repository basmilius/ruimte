import { describe, expect, test } from 'bun:test';
import { CLOUDFLARE_API, CloudflareApi, CloudflareError, type CloudflareFetch } from './cloudflare-api.ts';

const TOKEN = 'cf-api-token-0123456789-secret';

function answering(status: number, body: unknown): { send: CloudflareFetch; seen: Array<{ url: string; init: RequestInit }> } {
    const seen: Array<{ url: string; init: RequestInit }> = [];

    return {
        seen,
        send: async (url, init) => {
            seen.push({ url, init });

            return Response.json(body, { status });
        }
    };
}

describe('a call', () => {
    test('goes to api.cloudflare.com with the token in a header, and refuses a redirect', async () => {
        const { send, seen } = answering(200, { success: true, result: { id: 't', status: 'active' } });

        await new CloudflareApi(TOKEN, send).verifyToken();

        expect(seen[0]!.url).toBe(`${CLOUDFLARE_API}/user/tokens/verify`);
        expect(new Headers(seen[0]!.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
        expect(seen[0]!.init.redirect).toBe('error');
    });

    test('reads every page of the zones', async () => {
        const pages: string[] = [];
        const send: CloudflareFetch = async (url) => {
            const page = Number(new URL(url).searchParams.get('page'));

            pages.push(String(page));

            return Response.json({
                success: true,
                result: [{ id: `z${page}`, name: `z${page}.nl`, account: { id: 'a', name: 'Bas' } }],
                result_info: { total_pages: 3 }
            });
        };

        const zones = await new CloudflareApi(TOKEN, send).zones();

        expect(zones.map((zone) => zone.name)).toEqual(['z1.nl', 'z2.nl', 'z3.nl']);
        expect(pages).toEqual(['1', '2', '3']);
    });

    test('says what it was doing and why Cloudflare would not, for each kind of refusal', async () => {
        const refusal = async (status: number, message?: string): Promise<CloudflareError> => {
            const { send } = answering(status, { success: false, errors: message === undefined ? [] : [{ message }] });

            return (await new CloudflareApi(TOKEN, send).zones().catch((e: unknown) => e)) as CloudflareError;
        };

        expect(await refusal(401)).toMatchObject({ code: 'token-refused' });
        expect((await refusal(401)).message).toContain('Listing your Cloudflare zones failed. Cloudflare does not accept this API token');
        expect(await refusal(403)).toMatchObject({ code: 'no-permission' });
        expect((await refusal(403)).message).toContain('Zone read, DNS edit and Cloudflare Tunnel edit');
        expect(await refusal(404)).toMatchObject({ code: 'not-found' });
        expect(await refusal(429)).toMatchObject({ code: 'rate-limited' });
        expect((await refusal(500, 'Boom')).message).toBe('Listing your Cloudflare zones failed (Cloudflare answered 500). Cloudflare said: Boom');
    });

    test('says Cloudflare could not be reached when the network fails', async () => {
        const send: CloudflareFetch = async () => {
            throw new Error(`connect failed for ${TOKEN}`);
        };
        const error = (await new CloudflareApi(TOKEN, send).zones().catch((e: unknown) => e)) as CloudflareError;

        expect(error).toMatchObject({ code: 'unreachable' });
        expect(error.message).not.toContain(TOKEN);
    });

    test('cuts the token out of a sentence Cloudflare sent back', async () => {
        const { send } = answering(400, { success: false, errors: [{ message: `Bad value ${TOKEN}` }] });
        const error = (await new CloudflareApi(TOKEN, send).zones().catch((e: unknown) => e)) as CloudflareError;

        expect(error.message).toContain('Bad value [token]');
        expect(error.message).not.toContain(TOKEN);
    });

    test('refuses a token Cloudflare calls inactive', async () => {
        const { send } = answering(200, { success: true, result: { id: 't', status: 'disabled' } });

        expect(new CloudflareApi(TOKEN, send).verifyToken()).rejects.toMatchObject({ code: 'token-refused' });
    });

    test('treats a record that is gone as deleted', async () => {
        const { send } = answering(404, { success: false, errors: [{ message: 'Record does not exist' }] });

        expect(new CloudflareApi(TOKEN, send).deleteRecord('z', 'r', 'a.example.com')).resolves.toBeUndefined();
    });
});
