import { describe, expect, test } from 'bun:test';
import { blankQuoted, createScrubber } from './scrub.ts';
import { telemetryRelease } from './dsn.ts';

const LOCAL_SECRET = 'q7Zr2Lw9Xk4Pv8Nm3Bt6Hs1Jd5Fg0Ac_YeUoTiR-xQ';

const scrubber = createScrubber({
    home: '/Users/jane',
    username: 'jane',
    hostname: 'Janes-MacBook-Pro.local',
    redactions: () => [LOCAL_SECRET, 'acme-portal', '/Volumes/work/acme-portal']
});
const { scrubText } = scrubber;

describe('scrubText', () => {
    test('puts ~ for the home directory and drops the paths in a message', () => {
        expect(scrubText("ENOENT: no such file or directory, open '/Users/jane/Projects/x/.ruimte/project.json'")).toBe(
            "ENOENT: no such file or directory, open '<path>'"
        );
    });

    test('drops the home of another person and a Windows home', () => {
        expect(scrubText('read /home/piet/notes/a.md and C:\\Users\\piet\\Desktop\\b.txt')).toBe('read <path> and <path>');
    });

    test('keeps a route of one segment', () => {
        expect(scrubText('GET /health answered 500')).toBe('GET /health answered 500');
    });

    test('replaces the values it was handed, such as a project name, its folder and the local secret', () => {
        expect(scrubText('opening acme-portal in /Volumes/work/acme-portal failed')).toBe('opening <redacted> in <redacted> failed');
        expect(scrubText(`secret ${LOCAL_SECRET} refused`)).toBe('secret <redacted> refused');
    });

    test('reads the redactions at every scrub', () => {
        const names: string[] = [];
        const growing = createScrubber({ redactions: () => names });
        expect(growing.scrubText('project zebra-app')).toBe('project zebra-app');
        names.push('zebra-app');
        expect(growing.scrubText('project zebra-app')).toBe('project <redacted>');
    });

    test('drops the path, query and fragment of a URL, and an unknown host', () => {
        expect(scrubText('socket ws://127.0.0.1:4210/ws?token=abc closed')).toBe('socket ws://127.0.0.1:4210/<path> closed');
        expect(scrubText('fetch https://api.github.com/repos/jane/acme?access_token=zz failed')).toBe('fetch https://api.github.com/<path> failed');
        expect(scrubText('fetch https://intranet.corp.example/x failed')).toBe('fetch https://<host>/<path> failed');
        expect(scrubText('fetch https://user:pw@pulsar.ruimte.app/ failed')).toBe('fetch https://pulsar.ruimte.app/ failed');
        expect(scrubText('open file:///Users/jane/a.txt')).toBe('open file:///<path>');
    });

    test('redacts a token in a query outside a URL', () => {
        expect(scrubText('upgrade /ws?token=abc123&protocol=4')).toContain('token=<redacted>');
    });

    test('redacts secrets after a key, an auth scheme and a JWT', () => {
        expect(scrubText('password=hunter2 api_key: "xyz" client_secret=s3')).toBe('password=<redacted> api_key: "<redacted>" client_secret=<redacted>');
        expect(scrubText('Authorization: Bearer abc.def')).not.toContain('abc.def');
        expect(scrubText('got eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl')).toBe('got <redacted>');
    });

    test('redacts the value of an environment variable', () => {
        expect(scrubText('spawned with OPENAI_API_KEY=sk-123 HOME=/x')).toBe('spawned with OPENAI_API_KEY=<redacted> HOME=<redacted>');
    });

    test('redacts a long token without a key', () => {
        expect(scrubText('refused 3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a')).toBe('refused <redacted>');
    });

    test('drops e-mail and IP addresses but keeps loopback and clocks', () => {
        expect(scrubText('jane@example.com from 192.168.1.20 and fe80::1ff:fe23:4567:890a')).toBe('<email> from <ip> and <ip>');
        expect(scrubText('127.0.0.1 and ::1 at 08:35:12')).toBe('127.0.0.1 and ::1 at 08:35:12');
    });

    test('drops the username and the hostname', () => {
        expect(scrubText('Jane on Janes-MacBook-Pro.local and Janes-MacBook-Pro')).toBe('<user> on <host> and <host>');
    });

    test('drops SQL to the end', () => {
        expect(scrubText('near "x": syntax error in SELECT name FROM customers WHERE id = 1')).toBe('near "x": syntax error in <sql>');
        expect(scrubText("insert into orders values ('a')")).toBe('<sql>');
    });

    test('drops quoted text that reads like content', () => {
        expect(scrubText("Project 'my secret plans' was not found")).toBe("Project '<text>' was not found");
        expect(scrubText("Cannot find module '@adecore/agents'")).toBe("Cannot find module '@adecore/agents'");
    });
});

describe('blankQuoted', () => {
    test('blanks a quoted span of any length in any of the three quotes', () => {
        expect(blankQuoted('unexpected token `customerName` at 3:14')).toBe('unexpected token `<text>` at 3:14');
        expect(blankQuoted(`expected 'x' or "id", found \`;\``)).toBe(`expected '<text>' or "<text>", found \`<text>\``);
    });

    test('leaves an apostrophe and text outside quotes alone', () => {
        expect(blankQuoted("can't parse 'total' here, it isn't valid")).toBe("can't parse '<text>' here, it isn't valid");
        expect(blankQuoted('thread main panicked at src/parser.rs:42:7')).toBe('thread main panicked at src/parser.rs:42:7');
    });
});

describe('scrubPath', () => {
    test('keeps the frame resolvable and drops the person and the query', () => {
        expect(scrubber.scrubPath('/Users/jane/Applications/Ruimte.app/Contents/Resources/app.asar/main.js?v=1')).toBe(
            '~/Applications/Ruimte.app/Contents/Resources/app.asar/main.js'
        );
        expect(scrubber.scrubPath('src/daemon.ts')).toBe('src/daemon.ts');
    });
});

describe('scrubEvent', () => {
    const event = {
        event_id: 'abc',
        timestamp: 1,
        level: 'error',
        platform: 'javascript',
        release: telemetryRelease('0.20.0'),
        environment: 'production',
        server_name: 'Janes-MacBook-Pro.local',
        user: { id: '1', ip_address: '10.0.0.4', username: 'jane' },
        request: { url: 'http://127.0.0.1/x', headers: { cookie: 'a=b' }, data: 'prompt text' },
        modules: { zod: '4' },
        sdk: { name: 'sentry.javascript.bun', version: '11', integrations: ['x'] },
        message: 'first line /Users/jane/a/b\nsecond line with file contents',
        tags: { launcher: 'service', project: 'acme-portal', helper: 'database' },
        extra: { stderr: ['ok', 'at /Users/jane/x/y'], exit_code: 3, prompt: 'write me a poem' },
        contexts: {
            os: { name: 'macOS', version: '26.1', machine: 'x' },
            device: { arch: 'arm64', boot_time: 'x', cpu_description: 'Apple M4' },
            culture: { locale: 'nl-NL', timezone: 'Europe/Amsterdam' },
            app: { app_memory: 1 },
            trace: { trace_id: 'x' }
        },
        breadcrumbs: [
            { category: 'console', message: 'chat says hello' },
            { category: 'ui.click', message: 'button[aria-label="Delete acme-portal now"]', timestamp: 2, data: { target: 'x' } },
            { category: 'navigation', data: { from: 'https://station.ruimte.app/p/123?x=1', to: 'https://station.ruimte.app/' } }
        ],
        exception: {
            values: [
                {
                    type: 'Error',
                    value: 'open /Users/jane/acme/.env failed\npassword=hunter2',
                    module: 'x',
                    mechanism: { type: 'onuncaughtexception', handled: false, data: { cwd: '/Users/jane' } },
                    stacktrace: {
                        frames: [
                            {
                                filename: '/Users/jane/.ruimte/bin/src/daemon.ts',
                                abs_path: '/Users/jane/.ruimte/bin/src/daemon.ts',
                                function: 'startDaemon',
                                lineno: 10,
                                colno: 4,
                                in_app: true,
                                context_line: 'const secret = "x";',
                                pre_context: ['a'],
                                post_context: ['b'],
                                vars: { secret: 'x' }
                            }
                        ]
                    }
                }
            ]
        },
        debug_meta: { images: [{ type: 'sourcemap', debug_id: 'd1', code_file: '/Users/jane/app/main.js' }] }
    };
    const scrubbed = scrubber.scrubEvent(event) as Record<string, unknown>;

    test('drops every field outside the allow-list', () => {
        for (const key of ['server_name', 'user', 'request', 'modules']) {
            expect(scrubbed[key]).toBeUndefined();
        }
        expect(scrubbed.release).toBe('ruimte@0.20.0');
        expect(scrubbed.sdk).toEqual({ name: 'sentry.javascript.bun', version: '11' });
    });

    test('keeps only the allowed tags and extras, scrubbed', () => {
        expect(scrubbed.tags).toEqual({ launcher: 'service', helper: 'database' });
        expect(scrubbed.extra).toEqual({ stderr: ['ok', 'at <path>'], exit_code: 3 });
    });

    test('keeps the first line of a message', () => {
        expect(scrubbed.message).toBe('first line <path>');
    });

    test('keeps the frames without their source and the mechanism without its data', () => {
        const value = (scrubbed.exception as { values: Array<Record<string, unknown>> }).values[0]!;
        expect(value.value).toBe('open <path> failed');
        expect(value.module).toBeUndefined();
        expect(value.mechanism).toEqual({ type: 'onuncaughtexception', handled: false });
        expect((value.stacktrace as { frames: unknown[] }).frames).toEqual([
            { filename: '~/.ruimte/bin/src/daemon.ts', abs_path: '~/.ruimte/bin/src/daemon.ts', function: 'startDaemon', lineno: 10, colno: 4, in_app: true }
        ]);
    });

    test('keeps the operating system, the runtime and the device architecture only', () => {
        expect(scrubbed.contexts).toEqual({ os: { name: 'macOS', version: '26.1' }, device: { arch: 'arm64' } });
    });

    test('keeps the allowed breadcrumbs, scrubbed', () => {
        expect(scrubbed.breadcrumbs).toEqual([
            { category: 'ui.click', message: 'button[aria-label="<text>"]', timestamp: 2 },
            { category: 'navigation', data: { from: 'https://station.ruimte.app/<path>', to: 'https://station.ruimte.app/' } }
        ]);
    });

    test('keeps the debug ids of the images', () => {
        expect(scrubbed.debug_meta).toEqual({ images: [{ type: 'sourcemap', debug_id: 'd1', code_file: '~/app/main.js' }] });
    });

    test('sends no transaction, replay or feedback', () => {
        expect(scrubber.scrubEvent({ type: 'transaction', spans: [] })).toBeNull();
        expect(scrubber.scrubEvent({ type: 'feedback' })).toBeNull();
    });

    test('takes the allowed tags from the context', () => {
        const own = createScrubber({ tags: ['surface'] });
        expect(own.scrubEvent<object>({ tags: { surface: 'station', launcher: 'x' } })).toEqual({ tags: { surface: 'station' } });
    });
});

describe('scrubEvent with a project named like a folder of the app', () => {
    const own = createScrubber({ home: '/Users/jane', username: 'jane', redactions: () => ['server', '/Users/jane/work/server'] });
    const frames = (input: Array<Record<string, unknown>>): unknown[] => {
        const event = own.scrubEvent({ exception: { values: [{ type: 'Error', value: 'server failed', stacktrace: { frames: input } }] } }) as {
            exception: { values: Array<{ value: string; stacktrace: { frames: unknown[] } }> };
        };
        expect(event.exception.values[0]!.value).toBe('<redacted> failed');
        return event.exception.values[0]!.stacktrace.frames;
    };

    test('keeps the frames of the app whole, and redacts the project in every other frame', () => {
        expect(
            frames([
                { filename: 'apps/server/src/daemon.ts', in_app: true },
                { filename: '/Users/jane/.ruimte/bin/apps/server/src/main.ts', in_app: true },
                { filename: '/Users/jane/work/server/node_modules/zod/index.js', in_app: false },
                { filename: 'server/lib.js' }
            ])
        ).toEqual([
            { filename: 'apps/server/src/daemon.ts', in_app: true },
            { filename: '~/.ruimte/bin/apps/server/src/main.ts', in_app: true },
            { filename: '<redacted>/node_modules/zod/index.js', in_app: false },
            { filename: '<redacted>/lib.js' }
        ]);
    });
});

describe('scrubBreadcrumb', () => {
    test('drops a category outside the allow-list', () => {
        expect(scrubber.scrubBreadcrumb({ category: 'console', message: 'hello' })).toBeNull();
        expect(scrubber.scrubBreadcrumb({ category: 'fetch', data: { url: 'https://x' } })).toBeNull();
        expect(scrubber.scrubBreadcrumb({ message: 'no category' })).toBeNull();
    });
});

describe('scrubLog', () => {
    test('keeps the first line and scalar attributes, scrubbed, without the host or a person', () => {
        const log = scrubber.scrubLog({
            level: 'warn',
            message: 'APNs delivery rejected for jane@example.com\nsecond line',
            attributes: {
                status: 410,
                startsActivity: false,
                reason: 'Bearer abc.def.ghi',
                'server.address': 'vps-1',
                'user.id': 'u1',
                details: { nested: true }
            }
        });
        expect(log).toEqual({
            level: 'warn',
            message: 'APNs delivery rejected for <email>',
            attributes: { status: 410, startsActivity: false, reason: 'Bearer <redacted>' }
        });
    });
});
