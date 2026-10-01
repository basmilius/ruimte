import { createContext } from 'react';
import type { ChatInfo } from '@ruimte/agent-contracts';

export const ReplyContext = createContext<{ provider: ChatInfo['provider']; chatId?: string } | null>(null);
