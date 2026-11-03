import { describe, expect, test } from 'bun:test';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { chatDrawers } from './drawn-chats';

function extension(id: string, enabled: boolean): InstalledClientExtension {
    return { manifest: { id, name: id, version: '1.0.0', api: 1 }, base: `/__extensions/${id}/x/`, enabled, hasClient: true, dev: false };
}

describe('which extensions draw their own chats', () => {
    const installed = [extension('acme.on', true), extension('acme.off', false)];

    test('only one that is installed and on', () => {
        const draws = chatDrawers(installed, true, false);
        expect(draws('acme.on')).toBe(true);
        expect(draws('acme.off')).toBe(false);
        expect(draws('acme.gone')).toBe(false);
    });

    test('none in safe mode, since nothing an extension draws runs there', () => {
        expect(chatDrawers(installed, true, true)('acme.on')).toBe(false);
    });

    test('each one before the list came, so a drawn chat does not flash into the sidebar', () => {
        expect(chatDrawers([], false, false)('acme.gone')).toBe(true);
    });
});
