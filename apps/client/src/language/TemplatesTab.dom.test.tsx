import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PersonalTemplates, TemplateListResult } from '@ruimte/contracts';
import { act } from 'react';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { TransportError } from '@/transport-api/transport';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything, typeInto } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const EMPTY: PersonalTemplates = { revision: 1, live: [], postfix: [], disabled: [], settings: {} };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"]:has(textarea)');
}

function switchNamed(label: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
}

async function typeIntoArea(area: HTMLTextAreaElement, text: string): Promise<void> {
    await act(async () => {
        area.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text);
        area.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function openTemplates(list: TemplateListResult | null = { personal: EMPTY, project: null }): Promise<void> {
    if (list !== null) {
        machine.answer('template.list', () => list);
    }
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'editor', target: 'editor.templates.live' }));
}

beforeEach(() => {
    machine = new FakeMachine();
    useToasts.setState({ toasts: [] });
});

afterEach(async () => {
    // The stores outlive the page, and the next file would open on these settings.
    useUi.getState().setSettings({ open: false, section: 'appearance', target: null });
    await page.unmount();
    workspace.close();
});

describe('the Templates tab of the editor settings', () => {
    test('a person without templates of their own is told how to get one, and still sees the built-ins', async () => {
        await openTemplates();

        await until(() => everything().includes('No templates of your own yet. Add one, or select code and choose Save as Live Template.'));
        expect(everything()).toContain('Prints a value to the console');
        expect(everything()).toContain('Built in');
        expect(machine.requests('template.list')).toEqual([{ projectId: 'project-atlas' }]);
    });

    test('a search that matches nothing says so', async () => {
        await openTemplates();
        await until(() => switchNamed('Use log') !== null);

        await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="Search templates"]')!, 'zzz');

        expect(everything()).toContain('No template matches "zzz".');
        expect(switchNamed('Use log')).toBeNull();
    });

    test('adding a template is refused with the editor reason until it is valid, then saved against the revision read', async () => {
        await openTemplates();
        machine.answer('template.save', ({ template }) => ({ revision: 2, kind: 'live' as const, template: { ...template, id: 'saved' } as never }));
        await until(() => buttonWithText('Add template') !== null);

        await clickOn(buttonWithText('Add template'));
        await until(() => dialog() !== null);
        await clickOn(buttonWithText('Save', dialog()!));

        expect(dialog()!.textContent).toContain('The key is one to 40 characters.');
        expect(machine.requests('template.save')).toEqual([]);

        await typeInto(dialog()!.querySelector('input')!, 'hi');
        await typeIntoArea(dialog()!.querySelector('textarea')!, 'hello($0);');
        await clickOn(buttonWithText('Save', dialog()!));

        await until(() => dialog() === null);
        expect(machine.requests('template.save')).toEqual([
            { scope: 'personal', revision: 1, kind: 'live', template: { key: 'hi', body: 'hello($0);', languages: ['javascript'], places: ['code'] } }
        ]);
        expect(everything()).toContain('Yours');
        expect(everything()).not.toContain('No templates of your own yet.');
    });

    test('the switch of a built-in sends the list of disabled ids against the revision read', async () => {
        await openTemplates();
        machine.answer('template.configure', ({ disabled }) => ({ revision: 2, disabled: disabled ?? [], settings: {} }));
        await until(() => switchNamed('Use log') !== null);

        await clickOn(switchNamed('Use log'));

        await until(() => machine.requests('template.configure').length > 0);
        expect(machine.requests('template.configure')).toEqual([{ revision: 1, disabled: ['builtin.javascript.log'] }]);
        await until(() => switchNamed('Use log')?.getAttribute('aria-checked') === 'false');
    });

    test('a revision conflict reads the list again and says so', async () => {
        await openTemplates();
        await until(() => switchNamed('Use log') !== null);
        machine.answer('template.configure', () => {
            throw new TransportError('rev-conflict', 'The templates are at revision 5');
        });
        machine.answer('template.list', () => ({ personal: { ...EMPTY, revision: 5 }, project: null }));

        await clickOn(switchNamed('Use log'));

        await until(() => useToasts.getState().toasts.some((toast) => toast.title === 'Templates changed elsewhere'));
        expect(machine.requests('template.list')).toHaveLength(2);
    });

    test('a project whose templates are from a newer Ruimte says they are left alone and cannot take new ones', async () => {
        await openTemplates({ personal: EMPTY, project: null, projectTooNew: true });

        await until(() => everything().includes("This project's templates come from a newer Ruimte and are left alone."));
        await clickOn(buttonWithText('Add template'));
        await until(() => dialog() !== null);

        const project = [...dialog()!.querySelectorAll<HTMLElement>('[role="radio"]')].find((option) => option.textContent === 'This project');
        expect(project?.hasAttribute('disabled') || project?.getAttribute('aria-disabled') === 'true').toBe(true);
    });

    test('a project whose templates file cannot be read says so', async () => {
        await openTemplates({ personal: EMPTY, project: null, projectInvalid: true });

        await until(() => everything().includes("This project's templates file cannot be read."));
    });

    test('a machine without templates is told it needs a newer Ruimte', async () => {
        machine.answersOnly(['project.open']);
        await openTemplates(null);

        await until(() => everything().includes('This machine needs a newer Ruimte for templates.'));
        expect(machine.requests('template.list')).toEqual([]);
    });
});
