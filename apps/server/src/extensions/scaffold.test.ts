import { describe, expect, test } from 'bun:test';
import client from '../../../client/package.json' with { type: 'json' };
import { CLIENT_REACT_MAJOR } from './scaffold.ts';

describe('a new extension', () => {
    test('starts on the major of React the client draws extensions with', () => {
        expect(client.dependencies.react).toStartWith(`^${CLIENT_REACT_MAJOR}.`);
    });
});
