import { isValidElement, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { CodeBlock } from '@/components/CodeBlock';
import { slugOf, textOf } from '@/lib/slug';

/* A heading links to itself, so a section can be shared. */
function Heading({ Tag, children }: { readonly Tag: 'h2' | 'h3'; readonly children?: ReactNode }) {
    const id = slugOf(textOf(children));

    return (
        <Tag id={id}>
            <a href={`#${id}`} className="anchor">
                {children}
            </a>
        </Tag>
    );
}

export function Heading2({ children }: { readonly children?: ReactNode }) {
    return <Heading Tag="h2">{children}</Heading>;
}

export function Heading3({ children }: { readonly children?: ReactNode }) {
    return <Heading Tag="h3">{children}</Heading>;
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
