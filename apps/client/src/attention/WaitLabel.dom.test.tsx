import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { mount, type Mounted } from '../../testing/dom';
import { WaitAge } from './WaitLabel';

const NOW = Date.UTC(2026, 9, 30, 10);
let page: Mounted;

beforeEach(() => {
    setSystemTime(NOW);
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    setSystemTime();
});

test.each([
    { label: 'less than a minute', since: NOW - 12_000, text: '< 1 min' },
    { label: 'one minute', since: NOW - 60_000, text: '1 min' },
    { label: 'an unknown zero date', since: 0, text: '' },
    { label: 'an unknown infinite date', since: Infinity, text: '' },
    { label: 'a negative date', since: -1, text: '' }
])('renders $label without suggesting a false age', async ({ since, text }) => {
    await page.render(<WaitAge since={since} />);
    expect(page.host.textContent).toBe(text);
});
