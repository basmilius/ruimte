import { describe, expect, test } from 'bun:test';
import { draftsOf, emptyDraft, variablesChanged, variablesOf, variablesProblem } from './variables';

const env = [
    { name: 'HTTPS_PROXY', value: 'http://proxy', sensitive: false },
    { name: 'API_TOKEN', value: '', sensitive: true, valueRedacted: true }
];

describe('the variables of an account', () => {
    test('a value the keychain holds goes back redacted, so the machine keeps it', () => {
        const drafts = draftsOf(env);
        expect(variablesProblem(drafts)).toBeNull();
        expect(variablesOf(drafts)).toEqual(env);
        expect(variablesChanged(drafts, env)).toBe(false);
    });

    test('a kept value is lost once it is renamed or made plain, so it has to be typed again', () => {
        const [proxy, token] = draftsOf(env);
        expect(variablesProblem([proxy!, { ...token!, name: 'OTHER_TOKEN' }])).toBe('OTHER_TOKEN needs a value.');
        expect(variablesProblem([proxy!, { ...token!, sensitive: false }])).toBe('API_TOKEN needs a value.');
        expect(variablesOf([{ ...token!, value: 'secret' }])).toEqual([{ name: 'API_TOKEN', value: 'secret', sensitive: true }]);
    });

    test('a name has to be a variable name, and only once', () => {
        const [proxy] = draftsOf(env);
        expect(variablesProblem([{ ...emptyDraft(false), value: 'x' }])).toBe('Every variable needs a name.');
        expect(variablesProblem([{ ...proxy!, name: '1PROXY' }])).toBe('1PROXY is not a variable name.');
        expect(variablesProblem([proxy!, { ...proxy!, key: 'again' }])).toBe('HTTPS_PROXY is set twice.');
    });

    test('an added row is a change', () => {
        expect(variablesChanged([...draftsOf(env), emptyDraft(false)], env)).toBe(true);
    });
});
