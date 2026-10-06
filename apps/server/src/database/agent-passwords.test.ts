import { describe, expect, test } from 'bun:test';
import { DatabasePasswords } from './agent-passwords.ts';

describe('the passwords agents open a server with', () => {
    test('answers only for the target a password was handed over with', () => {
        const passwords = new DatabasePasswords();
        passwords.hand('p1', 'client-1', [{ connectionId: 'shop', target: 'db.local', password: 'hunter2' }]);
        expect(passwords.passwordOf('p1', 'shop', 'db.local')).toBe('hunter2');
        expect(passwords.passwordOf('p1', 'shop', 'evil.example.com')).toBeNull();
        expect(passwords.passwordOf('p2', 'shop', 'db.local')).toBeNull();
    });

    test("a client's newer hand-over replaces its last one, and the client that spoke last is asked first", () => {
        const passwords = new DatabasePasswords();
        passwords.hand('p1', 'client-1', [{ connectionId: 'shop', target: 't', password: 'one' }]);
        passwords.hand('p1', 'client-2', [{ connectionId: 'shop', target: 't', password: 'two' }]);
        expect(passwords.passwordOf('p1', 'shop', 't')).toBe('two');
        passwords.hand('p1', 'client-2', []);
        expect(passwords.passwordOf('p1', 'shop', 't')).toBe('one');
        passwords.hand('p1', 'client-1', [{ connectionId: 'shop', target: 't', password: '' }]);
        expect(passwords.passwordOf('p1', 'shop', 't')).toBeNull();
    });

    test('forgets a project that was let go, and everything at once', () => {
        const passwords = new DatabasePasswords();
        passwords.hand('p1', 'client-1', [{ connectionId: 'shop', target: 't', password: 'one' }]);
        passwords.hand('p2', 'client-1', [{ connectionId: 'shop', target: 't', password: 'two' }]);
        passwords.forget('p1');
        expect(passwords.passwordOf('p1', 'shop', 't')).toBeNull();
        expect(passwords.passwordOf('p2', 'shop', 't')).toBe('two');
        passwords.clear();
        expect(passwords.passwordOf('p2', 'shop', 't')).toBeNull();
    });
});
