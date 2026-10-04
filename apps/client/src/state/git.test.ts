import { afterEach, expect, test } from 'bun:test';
import { endpointKey } from './keys';
import { useGit } from './git';

afterEach(() => useGit.setState({ messages: {}, messageVersions: {} }));

test('finishing a commit clears its draft only if nobody edited it while the commit ran', () => {
    const key = endpointKey('machine', '/repo');
    useGit.getState().setMessage(key, 'First commit');
    const version = useGit.getState().messageVersions[key]!;
    useGit.getState().setMessage(key, 'Next commit');
    useGit.getState().clearMessage(key, version);
    expect(useGit.getState().messages[key]).toBe('Next commit');
    useGit.getState().setMessage(key, 'First commit');
    useGit.getState().clearMessage(key, version);
    expect(useGit.getState().messages[key]).toBe('First commit');
    useGit.getState().clearMessage(key, useGit.getState().messageVersions[key]!);
    expect(useGit.getState().messages[key]).toBe('');
});

test('repositories at the same path on different machines keep separate drafts', () => {
    const first = endpointKey('first', '/repo');
    const second = endpointKey('second', '/repo');
    useGit.getState().setMessage(first, 'Local work');
    useGit.getState().setMessage(second, 'Remote work');
    useGit.getState().clearMessage(first, useGit.getState().messageVersions[first]!);
    expect(useGit.getState().messages[second]).toBe('Remote work');
});
