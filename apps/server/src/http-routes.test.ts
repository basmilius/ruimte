import type { Server } from 'bun';
import { describe, expect, test } from 'bun:test';
import { answerRoute, routeFor, type Route } from './http-routes.ts';

const answer = (): Response => new Response('ok');

function table(): Route<unknown>[] {
    return [
        { exact: ['/health'], handle: answer },
        { exact: ['/machine/link', '/machine/registration'], handle: answer },
        { below: '/hooks', handle: answer },
        { exact: ['/context'], below: '/context', handle: answer }
    ];
}

describe('routeFor', () => {
    test('answers an exact path only as it is', () => {
        const routes = table();
        expect(routeFor(routes, '/health')).toBe(routes[0]!);
        expect(routeFor(routes, '/health/more')).toBeNull();
        expect(routeFor(routes, '/machine/registration')).toBe(routes[1]!);
    });

    test('answers every path below a prefix but not the prefix itself', () => {
        const routes = table();
        expect(routeFor(routes, '/hooks/claude')).toBe(routes[2]!);
        expect(routeFor(routes, '/hooks')).toBeNull();
        expect(routeFor(routes, '/hookshot')).toBeNull();
    });

    test('answers a prefix itself when the route names it as exact too', () => {
        const routes = table();
        expect(routeFor(routes, '/context')).toBe(routes[3]!);
        expect(routeFor(routes, '/context/list')).toBe(routes[3]!);
    });

    test('takes the first route in the table that answers', () => {
        const first: Route<unknown> = { below: '/a', handle: answer };
        const second: Route<unknown> = { exact: ['/a/b'], handle: answer };
        expect(routeFor([first, second], '/a/b')).toBe(first);
    });
});

describe('answerRoute', () => {
    const server = { requestIP: () => null } as unknown as Server<unknown>;

    function post(path: string, length: number): Request {
        return new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-length': String(length) } });
    }

    test('refuses a body declared past what its route takes before the route reads it', async () => {
        let answered = 0;
        const counted = (): Response => {
            answered++;
            return answer();
        };
        const routes: Route<unknown>[] = [
            { below: '/canvas', bodyBytes: 100, handle: counted },
            { below: '/hooks', handle: counted }
        ];
        expect((await answerRoute(routes, post('/canvas/chat', 100), server, 10))?.status).toBe(200);
        expect((await answerRoute(routes, post('/canvas/chat', 101), server, 10))?.status).toBe(413);
        expect((await answerRoute(routes, post('/hooks/claude', 10), server, 10))?.status).toBe(200);
        expect((await answerRoute(routes, post('/hooks/claude', 11), server, 10))?.status).toBe(413);
        expect(answered).toBe(2);
    });
});
