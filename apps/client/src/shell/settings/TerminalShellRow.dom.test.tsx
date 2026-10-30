import { afterEach, describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { mount, type Mounted } from '../../../testing/dom';
import { TerminalShellRow } from './MachineSettings';

let page: Mounted;

function setMissing(gitBashMissing: boolean): void {
    useServers.setState((state) => ({
        byEndpoint: { ...state.byEndpoint, [LOCAL_ENDPOINT_ID]: { ...state.byEndpoint[LOCAL_ENDPOINT_ID]!, gitBashMissing } }
    }));
}

async function rowText(gitBashMissing: boolean): Promise<string> {
    setMissing(gitBashMissing);
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === LOCAL_ENDPOINT_ID);
    if (endpoint === undefined) {
        throw new Error('The local machine is always listed');
    }
    page = mount();
    await page.render(<TerminalShellRow endpoint={endpoint} reason={null} />);

    return document.body.textContent ?? '';
}

afterEach(async () => {
    await page.unmount();
    setMissing(false);
});

describe('the terminal shell on a Windows machine', () => {
    test('says what is missing without Git for Windows', async () => {
        expect(await rowText(true)).toContain('Git for Windows is not installed');
    });

    test('says nothing of it with Git for Windows', async () => {
        expect(await rowText(false)).not.toContain('Git for Windows is not installed');
    });
});
