/*
 * A `t` handed to a helper that builds words outside a component. Two overloads instead of an optional
 * `options`, since i18next 27's `TFunction` takes no `undefined` for them.
 */
export type Translate = {
    (key: string): string;
    (key: string, options: Record<string, unknown>): string;
};
