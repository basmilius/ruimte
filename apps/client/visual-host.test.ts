import { describe, expect, test } from 'bun:test';
import { VISUAL_HOST_PAGE } from '@ruimte/contracts';
import { VISUAL_HOST_CSP } from '@ruimte/csp';
import { visualHostPage } from './visual-host.ts';

type Middleware = (request: { url?: string }, response: FakeResponse, next: () => void) => void;

class FakeResponse {
    readonly headers = new Map<string, string>();
    body: string | null = null;

    setHeader(name: string, value: string): void {
        this.headers.set(name, value);
    }

    end(body: string): void {
        this.body = body;
    }
}

function middleware(): Middleware {
    let installed: Middleware | null = null;
    const hook = visualHostPage().configureServer as (server: unknown) => void;
    hook({
        middlewares: {
            use: (handler: Middleware) => {
                installed = handler;
            }
        }
    });
    if (installed === null) {
        throw new Error('The plugin installed no middleware');
    }
    return installed;
}

function ask(url: string): { response: FakeResponse; passed: boolean } {
    const response = new FakeResponse();
    let passed = false;
    middleware()({ url }, response, () => {
        passed = true;
    });
    return { response, passed };
}

describe('the host page of a visual in the dev server', () => {
    test('is answered under its own policy, never as the client', () => {
        for (const url of ['/__visual/', '/__visual/?reload=1']) {
            const { response, passed } = ask(url);
            expect(passed).toBe(false);
            expect(response.body).toBe(VISUAL_HOST_PAGE);
            expect(response.headers.get('content-security-policy')).toBe(VISUAL_HOST_CSP);
            expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
            expect(response.headers.get('x-content-type-options')).toBe('nosniff');
            expect(response.headers.get('cache-control')).toBe('no-cache');
        }
    });

    test('leaves every other address to the dev server', () => {
        for (const url of ['/', '/__visual', '/__visual/index.html', '/__visual/other', '/src/main.tsx']) {
            const { response, passed } = ask(url);
            expect(passed).toBe(true);
            expect(response.body).toBeNull();
        }
    });
});

describe('the host page of a visual in the build', () => {
    test('is written as a file at its path, the page and nothing else', () => {
        const emitted: { type: string; fileName: string; source: string }[] = [];
        const hook = visualHostPage().generateBundle as (this: unknown) => void;
        hook.call({ emitFile: (file: { type: string; fileName: string; source: string }) => emitted.push(file) });
        expect(emitted).toEqual([{ type: 'asset', fileName: '__visual/index.html', source: VISUAL_HOST_PAGE }]);
    });
});
