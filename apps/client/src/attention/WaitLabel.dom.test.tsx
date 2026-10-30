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
    { label: 'less than a minute', since: NOW - 12_000, text: 'now' },
    { label: 'one minute', since: NOW - 60_000, text: '1m' },
    { label: 'one and a half minutes', since: NOW - 90_000, text: '1m' },
    { label: 'less than ten minutes', since: NOW - 599_000, text: '9m' },
    { label: 'more than an hour', since: NOW - 7_500_000, text: '2h' },
    { label: 'an unknown zero date', since: 0, text: '' },
    { label: 'an unknown infinite date', since: Infinity, text: '' },
    { label: 'a negative date', since: -1, text: '' }
])('renders $label without suggesting a false age', async ({ since, text }) => {
    await page.render(<WaitAge since={since} />);
    expect(page.host.textContent).toBe(text);
});

test('the ten-minute label and overdue wording start together', async () => {
    await page.render(<WaitAge since={NOW - 599_000} />);
    expect(page.host.querySelector('time')!.getAttribute('aria-label')).toBe('Waiting for 9 min');
    await page.render(<WaitAge since={NOW - 600_000} />);
    expect(page.host.querySelector('time')!.getAttribute('aria-label')).toBe('Waiting for 10 min, at least ten minutes');
});
