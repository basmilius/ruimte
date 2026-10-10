export function listed(items: readonly string[]): string {
    return items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function plural(count: number, noun: string): string {
    return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
