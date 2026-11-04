import type { Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// Parse first, then sanitize: raw document HTML must never become executable app content.
export const FILE_HTML_PLUGINS: Options['rehypePlugins'] = [
    rehypeRaw,
    [
        rehypeSanitize,
        {
            ...defaultSchema,
            strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'object', 'embed', 'svg', 'math']
        }
    ]
];
