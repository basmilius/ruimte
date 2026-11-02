/* A doc comment of the types, with its backticks as code. */
export function InlineDoc({ text }: { readonly text: string }) {
    return (
        <>
            {text
                .split(/(`[^`]+`)/)
                .map((part, index) =>
                    part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : <span key={index}>{part}</span>
                )}
        </>
    );
}
