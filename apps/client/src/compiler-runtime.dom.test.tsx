import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { c, forgetMemoizedWords } from '@/compiler-runtime';
import { mount, type Mounted } from '../testing/dom';

let greeting = 'Hello';

/* What the compiler makes of `<span>{greetingOf(name)}</span>`: the words are kept until `name` changes. */
function Greeting({ name }: { name: string }) {
    const $ = c(2);
    if ($[0] !== name) {
        $[0] = name;
        $[1] = `${greeting}, ${name}`;
    }
    return <span>{$[1] as string}</span>;
}

describe('the compiled code’s memo cache', () => {
    let page: Mounted;

    afterEach(async () => {
        greeting = 'Hello';
        await page.unmount();
    });

    test('keeps what it worked out while its inputs stay, and works it out again once the words changed', async () => {
        page = mount();
        await page.render(<Greeting name="Bas" />);
        expect(page.host.textContent).toBe('Hello, Bas');

        greeting = 'Hallo';
        await page.render(<Greeting name="Bas" />);
        expect(page.host.textContent).toBe('Hello, Bas');

        await act(async () => forgetMemoizedWords());
        await page.render(<Greeting name="Bas" />);
        expect(page.host.textContent).toBe('Hallo, Bas');
    });
});
