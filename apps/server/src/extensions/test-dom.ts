/*
 * The page of a test host: draws a surface with the project's own React into the page a `*.dom.test.tsx` file has,
 * and waits for what React does after each step, over turns of the event loop rather than a clock.
 */
import type * as PublicTesting from '../../../../packages/extension/testing';
import { fromProject, nodeContextOf, react, type ReactDomClient, type ReactModule } from './test-react.ts';

type Screen = PublicTesting.TestScreen;

// Turns of the event loop a step waits for React before it gives up; no wall clock is read.
const MAX_TURNS = 200;
const SUSPENDED = 'ruimte-suspended';
const PRESSABLE = 'button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"], summary, label';

const mounted = new Set<() => void>();

/*
 * A step inside React's `act`, which renders what it scheduled and shows what resolved without a timer of its own, so a
 * test under fake timers moves on. The flag is on only for the step: an update a test makes itself draws unwarned.
 */
async function step(module: ReactModule, work: () => unknown): Promise<void> {
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = scope.IS_REACT_ACT_ENVIRONMENT;

    scope.IS_REACT_ACT_ENVIRONMENT = true;

    try {
        await module.act(async () => {
            await work();
        });
    } finally {
        scope.IS_REACT_ACT_ENVIRONMENT = before;
    }
}

/* One turn of the event loop: `setImmediate`, which the fake timers of `bun test` leave running, unlike `setTimeout`. */
function turn(module: ReactModule): Promise<void> {
    return step(module, () => new Promise((resolve) => setImmediate(resolve)));
}

export function unmountAll(): void {
    for (const unmount of [...mounted]) {
        unmount();
    }
}

function textOf(element: Element): string {
    return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/* The innermost element that says `text`, preferring one a person presses or types in. */
function findIn(container: HTMLElement, text: string, preferred: string): HTMLElement | null {
    const saying = (element: Element): boolean => textOf(element).includes(text) || element.getAttribute('aria-label') === text;
    const among = [...container.querySelectorAll<HTMLElement>(preferred)].filter(saying);

    if (among.length > 0) {
        return among.at(-1) ?? null;
    }

    const all = [...container.querySelectorAll<HTMLElement>('*')].filter(saying);

    return all.find((element) => ![...element.children].some(saying)) ?? null;
}

function fieldIn(container: HTMLElement, name: string): HTMLInputElement | HTMLTextAreaElement | null {
    const fields = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')];
    const labelled = fields.find(
        (field) =>
            field.placeholder === name ||
            field.name === name ||
            field.getAttribute('aria-label') === name ||
            (field.id !== '' && textOf(container.querySelector(`label[for="${field.id}"]`) ?? document.createElement('i')) === name) ||
            (field.closest('label') !== null && textOf(field.closest('label') as Element).includes(name))
    );

    return labelled ?? null;
}

async function settle(module: ReactModule, check: () => unknown, failure: () => string): Promise<void> {
    let last: unknown = null;

    for (let turns = 0; turns < MAX_TURNS; turns++) {
        try {
            if (check() !== false) {
                return;
            }

            last = null;
        } catch (e) {
            last = e;
        }

        await turn(module);
    }

    throw last instanceof Error ? last : new Error(failure());
}

function needsPage(): void {
    if (typeof document === 'undefined') {
        throw new Error('render draws into a page: name the test file *.dom.test.tsx, and ruimte extension test gives it one');
    }
}

/* The component and props of a definition, with its lazy import loaded, or a component of the test's own. */
async function drawable(target: object, options: { params?: unknown; context?: object; props?: object }): Promise<[unknown, object]> {
    if ('frame' in target) {
        throw new Error('A frame surface runs in its own page in Ruimte; render draws component surfaces');
    }

    if (typeof target === 'object' && 'component' in target && typeof target.component === 'function') {
        const loaded = (await (target.component as () => Promise<{ default: unknown }>)()).default;

        return [loaded, { params: options.params, ...(options.context === undefined ? {} : { context: options.context }), ...options.props }];
    }

    return [
        target,
        {
            ...(options.params === undefined ? {} : { params: options.params }),
            ...(options.context === undefined ? {} : { context: options.context }),
            ...options.props
        }
    ];
}

export async function render(target: object, options: { node?: string; params?: unknown; context?: object; props?: object } = {}): Promise<Screen> {
    needsPage();

    const module = react();
    const { createRoot } = fromProject<ReactDomClient>('react-dom/client');
    const [component, props] = await drawable(target, options);
    const container = document.createElement('div');
    const failure: { error: unknown } = { error: null };
    const drawn = { committed: false };

    // Beside the surface under one Suspense, so its effect runs only once the surface itself is on the page.
    const Committed = (): null => {
        module.useEffect(() => {
            drawn.committed = true;
        });

        return null;
    };

    // A surface that throws while it draws rejects the render, where Ruimte would show it failed in its own rectangle.
    class Boundary extends module.Component {
        static getDerivedStateFromError(error: unknown): object {
            failure.error = error;

            return { failed: true };
        }

        render(): unknown {
            return (this.state as { failed?: boolean } | null)?.failed === true ? null : (this.props as { children?: unknown }).children;
        }
    }

    document.body.append(container);

    // The render rejects with what the boundary caught, so React need not print it too.
    const root = createRoot(container, { onCaughtError: () => undefined });
    const unmount = (): void => {
        if (mounted.delete(unmount)) {
            root.unmount();
            container.remove();
        }
    };
    const after = async (): Promise<void> => {
        await turn(module);
        // A surface that still shows its fallback rejects the step, so a click never resolves on a page that is not there yet.
        await settle(
            module,
            () => failure.error !== null || container.querySelector(SUSPENDED) === null,
            () => `It is still waiting for what it suspends on, after ${MAX_TURNS} turns`
        );

        if (failure.error !== null) {
            const { error } = failure;

            failure.error = null;
            throw error;
        }
    };

    mounted.add(unmount);

    try {
        await step(module, () =>
            root.render(
                module.createElement(
                    Boundary,
                    null,
                    module.createElement(
                        module.Suspense,
                        { fallback: module.createElement(SUSPENDED) },
                        module.createElement(nodeContextOf(module).Provider, { value: options.node ?? null }, module.createElement(component, props)),
                        module.createElement(Committed)
                    )
                )
            )
        );
        await settle(
            module,
            () => failure.error !== null || drawn.committed,
            () => `It is still waiting for what it suspends on, after ${MAX_TURNS} turns`
        );
        await after();
    } catch (e) {
        unmount();

        throw e;
    }

    return {
        container,
        text: () => textOf(container),
        find: (text) => findIn(container, text, PRESSABLE),
        async click(target) {
            const element = typeof target === 'string' ? findIn(container, target, PRESSABLE) : target;

            if (element === null) {
                throw new Error(`Nothing says ${target} here. The page says: ${textOf(container)}`);
            }

            await step(module, () => (element as HTMLElement).click());
            await after();
        },
        async type(target, text) {
            const field = typeof target === 'string' ? fieldIn(container, target) : target;

            if (field === null || !('value' in field)) {
                throw new Error(`No field ${String(target)} here`);
            }

            // Through the element's own setter, so React sees a change as it does when a person types.
            const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;

            await step(module, () => {
                Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, text);
                field.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await after();
        },
        until: (check) => settle(module, check, () => `Still not so after ${MAX_TURNS} turns. The page says: ${textOf(container)}`),
        unmount
    };
}
