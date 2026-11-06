import { describe, expect, test } from 'bun:test';
import { privateSentryOptions } from './options.ts';
import { createScrubber } from './scrub.ts';

const scrubber = createScrubber({ tags: [] });

describe('privateSentryOptions', () => {
    test('switches off everything the SDK collects on its own', () => {
        const options = privateSentryOptions({ dsn: 'https://key@ingest.test/1', release: 'ruimte@1.0.0', beforeSend: scrubber.scrubEvent });
        expect(options).toMatchObject({
            dsn: 'https://key@ingest.test/1',
            release: 'ruimte@1.0.0',
            environment: 'production',
            defaultIntegrations: false,
            attachStacktrace: false,
            maxBreadcrumbs: 0,
            sendClientReports: false
        });
        expect(options.dataCollection.userInfo).toBe(false);
        expect(options.beforeBreadcrumb()).toBeNull();
    });

    test('leaves out the release it was not given and the log scrubbing of a surface without logs', () => {
        const options = privateSentryOptions({ dsn: 'https://key@ingest.test/1', release: null, beforeSend: scrubber.scrubEvent });
        expect('release' in options).toBe(false);
        expect('beforeSendLog' in options).toBe(false);
    });

    test('leaves the default integrations to an init that drops them itself', () => {
        const options = privateSentryOptions({
            dsn: 'https://key@ingest.test/1',
            beforeSend: scrubber.scrubEvent,
            scrubLog: scrubber.scrubLog,
            initWithoutDefaultIntegrations: true
        });
        expect('defaultIntegrations' in options).toBe(false);
        expect(options.beforeSendLog).toBe(scrubber.scrubLog);
    });
});
