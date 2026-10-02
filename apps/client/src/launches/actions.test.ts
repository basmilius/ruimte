import { describe, expect, test } from 'bun:test';
import { launchTarget } from './actions';

describe('what a launch acts on', () => {
    const onScreen = { endpointId: 'local', projectId: 'b' };

    test('the project on screen, when nothing names another', () => {
        expect(launchTarget(onScreen)).toEqual({ endpointId: 'local', projectId: 'b', key: 'local:b' });
        expect(launchTarget(null)).toBeNull();
    });

    test('a toast from another project does nothing to the one on screen', () => {
        // `dev` of project a failed, and the person switched to b before pressing "Start again".
        expect(launchTarget(onScreen, { endpointId: 'local', projectId: 'a' })).toBeNull();
        expect(launchTarget(onScreen, { endpointId: 'laptop', projectId: 'b' })).toBeNull();
        expect(launchTarget(onScreen, { endpointId: 'local', projectId: 'b' })).toEqual({ endpointId: 'local', projectId: 'b', key: 'local:b' });
    });
});
