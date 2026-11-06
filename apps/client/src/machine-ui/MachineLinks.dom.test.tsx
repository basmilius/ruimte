import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PeerLink } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, endpointById } from '@/state/endpoints';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { MachineLinks } from './MachineSettings';

const LINK: PeerLink = {
    machineId: 'machine-b',
    label: 'MacBook Pro',
    projectId: 'atlas',
    projectName: 'Atlas',
    ceiling: 'supervised',
    createdAt: Date.UTC(2026, 9, 14)
};

let machine: FakeMachine;
let links: PeerLink[];
let disconnect: () => void;
let page: Mounted;

function everything(): string {
    return document.body.textContent ?? '';
}

function button(label: string): HTMLElement | null {
    return (
        [...document.querySelectorAll<HTMLElement>('button')].find(
            (element) => element.textContent?.trim() === label || element.getAttribute('aria-label') === label
        ) ?? null
    );
}

async function show(): Promise<void> {
    page = mount();
    await page.render(<MachineLinks endpoint={endpointById(LOCAL_ENDPOINT_ID)!} />);
}

beforeEach(() => {
    links = [LINK];
    machine = new FakeMachine();
    machine.answer('peer.list', () => ({ links }));
    machine.answer('peer.setCeiling', (payload) => {
        links = links.map((link) => ({ ...link, ceiling: payload.ceiling }));
        return {};
    });
    machine.answer('peer.unbind', () => {
        links = [];
        return {};
    });
    disconnect = connectFakeMachine(machine);
});

afterEach(async () => {
    await page.unmount();
    disconnect();
});

describe('MachineLinks', () => {
    test('lists the project another machine works in', async () => {
        await show();
        await until(() => everything().includes('Atlas'));
        expect(everything()).toContain('from MacBook Pro');
        expect(everything()).toContain('not used yet');
    });

    test('says so when no machine works here', async () => {
        links = [];
        await show();
        await until(() => everything().includes('No other machine works in a project on this machine.'));
    });

    test('a failing list shows the failure instead of an empty list', async () => {
        machine.answer('peer.list', () => Promise.reject(new Error('The list is gone')));
        await show();
        await until(() => everything().includes('The list is gone'));
        expect(everything()).not.toContain('No other machine works');
    });

    test('is not drawn for a machine that does not answer peer.list', async () => {
        machine.answersOnly(['project.list']);
        await show();
        await until(() => machine.requests('peer.list').length === 0 && !everything().includes('Linked projects'));
    });

    test('a changed mode goes to the machine', async () => {
        await show();
        await until(() => everything().includes('Atlas'));
        await clickOn(document.querySelector('[aria-label="Highest mode for agents from MacBook Pro"]'));
        await until(() => document.querySelector('[role="option"]') !== null);
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent?.includes('Full access'));
        await clickOn(option ?? null);
        await until(() => machine.requests('peer.setCeiling').length === 1);
        expect(machine.requests('peer.setCeiling')[0]).toEqual({ machineId: 'machine-b', projectId: 'atlas', ceiling: 'full-access' });
    });

    test('Unlink asks first and then sends peer.unbind', async () => {
        await show();
        await until(() => everything().includes('Atlas'));
        await clickOn(button('Unlink Atlas from MacBook Pro'));
        await until(() => everything().includes('Unlink Atlas from MacBook Pro?'));
        expect(machine.requests('peer.unbind')).toHaveLength(0);
        await clickOn(button('Unlink'));
        await until(() => machine.requests('peer.unbind').length === 1);
        expect(machine.requests('peer.unbind')[0]).toEqual({ machineId: 'machine-b', projectId: 'atlas' });
        await until(() => everything().includes('No other machine works in a project on this machine.'));
    });
});
