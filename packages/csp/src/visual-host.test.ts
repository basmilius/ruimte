import { describe, expect, test } from 'bun:test';
import { VISUAL_HOST_CSP, VISUAL_HOST_PATH } from './index.ts';
import { VISUAL_HOST, visualHostResponse } from './visual-host.ts';

describe('the answer of the visual host page', () => {
    test('is the page at its path under the headers of its own policy', async () => {
        expect(VISUAL_HOST.path).toBe(VISUAL_HOST_PATH);
        const response = visualHostResponse();
        expect(await response.text()).toBe(VISUAL_HOST.body);
        expect(VISUAL_HOST.body).toStartWith('<!doctype html>');
        expect(response.headers.get('content-security-policy')).toBe(VISUAL_HOST_CSP);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    });
});
