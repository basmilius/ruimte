import Link from 'next/link';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { CodeBlock } from '@/components/docs/CodeBlock';
import { slugOf, textOf } from '@/lib/docs/slug';

interface HeadingProps {
    /* Without one, the slug of the text. */
    readonly id?: string;
    readonly children?: ReactNode;
}

/* A heading links to itself, so a section can be shared. */
function Heading({ Tag, id, children }: HeadingProps & { readonly Tag: 'h2' | 'h3' }) {
    const anchor = id ?? slugOf(textOf(children));

    return (
        <Tag id={anchor}>
            <a href={`#${anchor}`} className="anchor">
                {children}
            </a>
        </Tag>
    );
}

export function Heading2(props: HeadingProps) {
    return <Heading Tag="h2" {...props} />;
}

export function Heading3(props: HeadingProps) {
    return <Heading Tag="h3" {...props} />;
}

/* A fence arrives as <pre><code class="language-ts">; the highlighter takes it whole. */
export function Pre({ children }: { readonly children?: ReactNode }) {
    if (!isValidElement(children)) {
        return <pre>{children}</pre>;
    }

    const code = children as ReactElement<{ className?: string; children?: ReactNode }>;
    const language = /language-(\w+)/.exec(code.props.className ?? '')?.[1];

    return <CodeBlock code={textOf(code.props.children)} language={language} />;
}

export function Anchor({ href = '', children }: { readonly href?: string; readonly children?: ReactNode }) {
    if (href.startsWith('/') || href.startsWith('#')) {
        return <Link href={href}>{children}</Link>;
    }

    return (
        <a href={href} rel="noreferrer">
            {children}
        </a>
    );
}
