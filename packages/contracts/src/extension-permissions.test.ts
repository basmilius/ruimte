import { expect, test } from 'bun:test';
import { EXTENSION_CLIENT_PERMISSIONS } from './extension-client.ts';
import { EXTENSION_ACTIONS, EXTENSION_PERMISSIONS, extensionFrameHost, extensionPermissionProblems, isExtensionPermission } from './extension-permissions.ts';

test('every permission a call or an action needs is one a manifest may ask for', () => {
    const needed = new Set([...Object.values(EXTENSION_CLIENT_PERMISSIONS), ...Object.values(EXTENSION_ACTIONS)]);

    expect([...needed].filter((permission) => !EXTENSION_PERMISSIONS.includes(permission))).toEqual([]);
});

test('a net: permission names a host name and nothing a policy reads as more', () => {
    expect(extensionFrameHost('net:api.example.com')).toBe('api.example.com');
    expect(extensionFrameHost('net:*.example.com')).toBe('*.example.com');
    expect(extensionFrameHost('net:localhost:8080')).toBe('localhost:8080');
    expect(extensionFrameHost('net:a.com; frame-src https:')).toBeNull();
    expect(extensionFrameHost('net:a.com https://b.com')).toBeNull();
    expect(extensionFrameHost('net:https://a.com')).toBeNull();
    expect(extensionFrameHost('net:')).toBeNull();
    expect(extensionFrameHost('files.read')).toBeNull();
});

test('a manifest is told which of its permissions this Ruimte does not know', () => {
    expect(isExtensionPermission('chats.send')).toBe(true);
    expect(isExtensionPermission('chat.send')).toBe(false);
    expect(extensionPermissionProblems({ 'files.read': 'Reads', 'chat.send': 'Sends', 'net:a.com;': 'Calls' })).toEqual([
        'chat.send is not a permission this Ruimte knows (canvas.write, views.write, artifacts.read, artifacts.write, browser.control, context.read, database.read, devices.control, languages.servers, launches.read, launches.run, routines.read, routines.run, terminals.read, files.read, files.write, git.read, chats.read, chats.send, agents.run, agents.start, agents.status, agents.tools, usage.read, clock or net:<host>)',
        'net:a.com; does not name a host; write net:example.com'
    ]);
    expect(extensionPermissionProblems(undefined)).toEqual([]);
});
