import type { Hosts } from './hosts.ts';
import type { HostLinks } from './links.ts';

/*
 * The hosts of a project as an agent reaches them: it reads what a person reads in the Issues panel, and the only
 * thing it writes is which issues its own chat works on, which never leaves this machine.
 */
export interface HostsAgentHost {
    hosts: Pick<Hosts, 'has' | 'status' | 'issues' | 'issue' | 'changes' | 'change' | 'changeOfChat' | 'checkLog' | 'resolve'>;
    links: Pick<HostLinks, 'of' | 'chatsOf' | 'link' | 'unlink'>;
}
