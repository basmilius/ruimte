import { describe, expect, test } from 'bun:test';
import { EXTENSION_PERMISSIONS } from './extension-permissions.ts';
import {
    allowsProposed,
    EXTENSION_PROPOSED_PARTS,
    EXTENSION_PROVIDER_POINTS,
    extensionProvidesProblems,
    proposedPackWarning,
    proposedPartsOf,
    proposedRefusal,
    providedIds,
    providerRefusal
} from './extension-providers.ts';

const HARBOR = {
    id: 'dev.harbor',
    permissions: { 'terminals.profiles': 'Adds a shell' },
    provides: { terminalProfiles: ['service-shell'] },
    proposed: ['terminalProfiles']
};

describe('the provider points', () => {
    test('each take a permission a manifest may ask for', () => {
        expect(Object.values(EXTENSION_PROVIDER_POINTS).filter((point) => !EXTENSION_PERMISSIONS.includes(point.permission))).toEqual([]);
    });

    test('are a proposed part while they are proposed', () => {
        expect(EXTENSION_PROPOSED_PARTS).toEqual(Object.keys(EXTENSION_PROVIDER_POINTS).filter((kind) => EXTENSION_PROVIDER_POINTS[kind]?.proposed));
        expect(EXTENSION_PROPOSED_PARTS).toContain('terminalProfiles');
    });
});

describe('what a manifest provides', () => {
    test('holds together with its permission and its name under proposed', () => {
        expect(extensionProvidesProblems(HARBOR)).toEqual([]);
        expect(extensionProvidesProblems({})).toEqual([]);
    });

    test('is told of a kind and a proposed part this Ruimte does not know, a missing permission and a part it did not name', () => {
        expect(extensionProvidesProblems({ provides: { machines: ['devcontainer'] }, proposed: ['machines'] })).toEqual([
            'machines is not a proposed part this Ruimte knows (terminalProfiles, launchSources, problemSources, machineSources, notificationChannels, uiSources, references, slashCommands)',
            'provides.machines is not something this Ruimte takes from an extension (terminalProfiles, launchSources, problemSources, machineSources, notificationChannels, uiSources, references, slashCommands)'
        ]);
        expect(extensionProvidesProblems({ provides: HARBOR.provides })).toEqual([
            'provides.terminalProfiles needs the permission terminals.profiles',
            'provides.terminalProfiles is still proposed; name terminalProfiles under proposed'
        ]);
    });
});

describe('a proposed part', () => {
    test('works under a dev link, as a development extension and as a built-in, and for nothing a person installed', () => {
        expect(['dev-link', 'development', 'built-in', 'installed', 'elsewhere', undefined].map(allowsProposed)).toEqual([
            true,
            true,
            true,
            false,
            false,
            false
        ]);
    });

    test('keeps an extension that names or uses one from running where it does not work, in words a person reads', () => {
        const reason =
            'This extension uses a part of Ruimte that is not final yet (terminalProfiles). It works while its author develops it, and an installed extension cannot use it.';

        expect(proposedRefusal(HARBOR, 'installed')).toBe(reason);
        expect(proposedRefusal({ proposed: ['terminalProfiles'] }, 'installed')).toBe(reason);
        expect(proposedRefusal({ provides: HARBOR.provides }, undefined)).toBe(reason);
        expect(proposedRefusal(HARBOR, 'dev-link')).toBeNull();
        expect(proposedRefusal(HARBOR, 'built-in')).toBeNull();
        expect(proposedRefusal({ permissions: { 'files.read': 'Reads' } }, 'installed')).toBeNull();
    });

    test('is what pack and publish warn of', () => {
        expect(proposedPartsOf(HARBOR)).toEqual(['terminalProfiles']);
        expect(proposedPackWarning(HARBOR)).toBe(
            'dev.harbor uses proposed parts (terminalProfiles). They work under ruimte extension dev, and an install from the store or of this pack is refused.'
        );
        expect(proposedPackWarning({ id: 'acme.plain' })).toBeNull();
    });

    test('is registered only by a manifest that names it, lists the id and came a way it works for', () => {
        expect(providerRefusal(HARBOR, 'defineTerminalProfile', 'service-shell', true)).toBeNull();
        expect(providerRefusal({ ...HARBOR, proposed: [] }, 'defineTerminalProfile', 'service-shell', true)).toBe(
            'defineTerminalProfile is still proposed; name terminalProfiles under proposed in manifest.json'
        );
        expect(providerRefusal(HARBOR, 'defineTerminalProfile', 'service-shell', false)).toBe(
            'defineTerminalProfile is still proposed, which an installed extension cannot use'
        );
        expect(providerRefusal(HARBOR, 'defineTerminalProfile', 'another', true)).toBe(
            'defineTerminalProfile got another, which manifest.json does not list under provides.terminalProfiles'
        );
        expect(providerRefusal(HARBOR, 'defineNothing', 'service-shell', true)).toBe('defineNothing registers nothing this Ruimte takes from an extension');
    });

    test('supplies its ids only with the permission, named as proposed, where a proposed part works', () => {
        expect(providedIds(HARBOR, 'terminalProfiles', true)).toEqual(['service-shell']);
        expect(providedIds(HARBOR, 'terminalProfiles', false)).toEqual([]);
        expect(providedIds({ ...HARBOR, permissions: {} }, 'terminalProfiles', true)).toEqual([]);
        expect(providedIds({ ...HARBOR, proposed: [] }, 'terminalProfiles', true)).toEqual([]);
        expect(providedIds(HARBOR, 'machines', true)).toEqual([]);
    });
});
