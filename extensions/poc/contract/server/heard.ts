const chats: string[] = [];

export function hear(chatId: string): void {
    chats.push(chatId);
}

export function heard(): string[] {
    return [...chats];
}
