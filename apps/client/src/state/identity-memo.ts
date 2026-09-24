type Level = WeakMap<object, Level | { value: unknown }>;

/*
 * Remembers what `derive` made of these exact objects. A store replaces a slice only when it changes,
 * so a selector that derives from slices runs on every change of the store (a pan included) and
 * gets the earlier answer back until one of its own slices is new. Entries go with their objects.
 */
export const memoByIdentity = <Args extends object[], Result>(derive: (...args: Args) => Result): ((...args: Args) => Result) => {
    const root: Level = new WeakMap();
    return (...args: Args): Result => {
        let level = root;
        for (const arg of args.slice(0, -1)) {
            let next = level.get(arg) as Level | undefined;
            if (next === undefined) {
                next = new WeakMap();
                level.set(arg, next);
            }
            level = next;
        }
        const last = args[args.length - 1]!;
        const known = level.get(last) as { value: Result } | undefined;
        if (known !== undefined) {
            return known.value;
        }
        const value = derive(...args);
        level.set(last, { value });
        return value;
    };
};
