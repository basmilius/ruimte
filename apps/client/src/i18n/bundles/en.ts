const resources = import.meta.glob<Record<string, unknown>>('../locales/en/*.json', { eager: true, import: 'default' });
// A built-in brings its own words, in a namespace named after its folder.
const extensions = import.meta.glob<Record<string, unknown>>('../../../../../extensions/*/locales/en.json', { eager: true, import: 'default' });

export default {
    ...Object.fromEntries(Object.entries(resources).map(([path, resource]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), resource])),
    ...Object.fromEntries(Object.entries(extensions).map(([path, resource]) => [path.split('/').at(-3) as string, resource]))
};
