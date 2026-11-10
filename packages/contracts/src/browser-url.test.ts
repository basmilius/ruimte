import { describe, expect, test } from 'bun:test';
import { agentAddressProblem, normalizeUrl } from './browser-url.ts';

describe('the address of a page', () => {
    test('gets a scheme when it has none: http for a local host, https for the rest', () => {
        expect(normalizeUrl('localhost:3000/demo')).toBe('http://localhost:3000/demo');
        expect(normalizeUrl('192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
        expect(normalizeUrl('  example.com/a ')).toBe('https://example.com/a');
        expect(normalizeUrl('')).toBe('about:blank');
    });

    test('keeps the scheme it has', () => {
        expect(normalizeUrl('http://example.com')).toBe('http://example.com');
        expect(normalizeUrl('file:///etc/hosts')).toBe('file:///etc/hosts');
    });

    test('is open to an agent when it is a web address or the blank page', () => {
        expect(agentAddressProblem('https://example.com')).toBeNull();
        expect(agentAddressProblem('http://localhost:3000')).toBeNull();
        expect(agentAddressProblem('about:blank')).toBeNull();
        expect(agentAddressProblem('file:///etc/hosts')).toBe('scheme');
        expect(agentAddressProblem('javascript:alert(1)')).toBe('scheme');
        expect(agentAddressProblem('https://')).toBe('invalid');
    });
});
