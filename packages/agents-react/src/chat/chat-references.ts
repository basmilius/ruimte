/* Another chat a message may point at, under the name it has right now. */
export interface ProjectChat {
    id: string;
    title: string;
}

/* The chats an `@query` offers: never the chat typing it or one already attached. */
export const chatSuggestions = (chats: readonly ProjectChat[], query: string, exclude: readonly string[], limit: number): ProjectChat[] => {
    const needle = query.toLowerCase();
    return chats.filter((chat) => !exclude.includes(chat.id) && chat.title.toLowerCase().includes(needle)).slice(0, limit);
};
