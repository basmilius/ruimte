import { Binding } from '../binding.ts';

/*
 * The way a wiring module reaches a bundle that is made after it: `later.git()` gives the bundle, and
 * throws when the daemon has not wired it yet, so a call before then fails where it is made instead
 * of answering for a service that is not there. `provide` hands the bundle over; `wire-daemon.ts` does
 * that right after each wiring step.
 */
export type Later<Bundles> = { readonly [Name in keyof Bundles]: () => Bundles[Name] };

export interface Lateness<Bundles> {
    readonly later: Later<Bundles>;
    provide<Name extends keyof Bundles>(name: Name, bundle: Bundles[Name]): Bundles[Name];
}

export function lateness<Bundles extends object>(): Lateness<Bundles> {
    const slots = new Map<PropertyKey, Binding<unknown>>();
    const slot = (name: PropertyKey): Binding<unknown> => {
        let found = slots.get(name);
        if (found === undefined) {
            found = new Binding<unknown>(`${String(name)} of the daemon`);
            slots.set(name, found);
        }

        return found;
    };
    const later = new Proxy({} as Later<Bundles>, { get: (_target, name) => () => slot(name).get() });

    return {
        later,
        provide: (name, bundle) => {
            slot(name).bind(bundle);

            return bundle;
        }
    };
}
