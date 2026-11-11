const resources = import.meta.glob<Record<string, unknown>>('../locales/en/*.json', { eager: true, import: 'default' });

export default Object.fromEntries(Object.entries(resources).map(([path, resource]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), resource]));
