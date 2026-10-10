import { afterEach, beforeEach, expect, test } from 'bun:test';
import { useEndpoints } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { openUiLink, openUiUrl } from './ui-links';

function titles(): string[] {
    return useToasts.getState().toasts.map((toast) => toast.title);
}

const before = useEndpoints.getState().activeId;

beforeEach(() => {
    useEndpoints.setState({ activeId: 'here' });
});

afterEach(() => {
    useEndpoints.setState({ activeId: before });
    useToasts.setState({ toasts: [] });
});

test('a link into another machine or project says why it does not open', () => {
    openUiLink('elsewhere', { state: 'chip', target: { type: 'Node', id: 'node' } });
    expect(titles()).toEqual(['This link leads into a project that is not open in this window.']);
});

test('a plain link opens nothing and says nothing', () => {
    openUiLink('elsewhere', { state: 'plain', reason: 'gone' });
    expect(titles()).toEqual([]);
});

test('an address that is not a web address says so', () => {
    openUiUrl('here', 'javascript:alert(1)');
    openUiUrl('here', 'not a url');
    expect(titles()).toEqual(['This link is not a web address Ruimte opens.', 'This link is not a web address Ruimte opens.']);
});
