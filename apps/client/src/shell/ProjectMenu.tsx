import { Icon, IconButton, Tooltip, Menu, ProjectSwitcher, ProjectSwitcherGroups } from '@adecore/ui';
import { FolderOpen, MessageSquarePlus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectMenuRow } from '@/clients/project/list';
import { MachineGlyph } from '@/machines/MachineGlyph';
import { newChat } from '@/project/new-chat';
import { openProjectClickAction } from '@/project/open-actions';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { useProjectMenu, type ProjectMenuModel } from '@/shell/project-menu-model';
import { useUi } from '@/state/ui';

/*
 * The Chats project of this machine, with a new chat on the edge where a project row has its actions.
 * A machine that has made no chat yet has no Chats project to open, so it only offers the new chat.
 */
function ChatsRow({ chats, offersChat }: { chats: ProjectMenuRow | null; offersChat: boolean }) {
    const { t } = useTranslation('shell');

    if (chats === null) {
        return (
            <Menu.Item onClick={newChat}>
                <Icon icon={MessageSquarePlus} size={14} /> {t('chats.newChat')}
            </Menu.Item>
        );
    }
    const open = (
        <Menu.Item onClick={(event) => openProjectClickAction(event, chats.endpointId, chats.summary.projectId)}>
            <ProjectGlyph
                projectId={chats.summary.projectId}
                endpointId={chats.endpointId}
                icon={chats.summary.icon}
                color={chats.summary.color}
                size={14}
                scratch
            />{' '}
            {t('chats.name')}
        </Menu.Item>
    );
    if (!offersChat) {
        return open;
    }
    return (
        <Menu.Row aria-label={t('chats.name')}>
            {open}
            <Menu.RowAction icon={Plus} label={t('chats.newChat')} onClick={newChat} />
        </Menu.Row>
    );
}

function OpenFolderItem() {
    const { t } = useTranslation('shell');
    return (
        <Menu.Item onClick={() => useUi.getState().openFolderBrowser()}>
            <Icon icon={FolderOpen} size={14} /> {t('projectMenu.openFolder')}
        </Menu.Item>
    );
}

function chatsRowOf(model: ProjectMenuModel): ReactNode {
    return model.chats !== null || model.offersChat ? <ChatsRow chats={model.chats} offersChat={model.offersChat} /> : undefined;
}

/*
 * The menu behind the plus at the end of the tabs. The open projects are the tabs themselves, so it
 * offers what a tab can come from: the projects closed lately, the Chats project and a folder.
 */
export function ProjectAddMenu({ model }: { model: ProjectMenuModel }) {
    const { t } = useTranslation('shell');
    return (
        <Menu.Root>
            <IconButton render={<Menu.Trigger />} icon={Plus} size="sm" label={t('projectTabs.add')} />
            <Menu.Popup className="min-w-60">
                <ProjectSwitcherGroups
                    projects={model.recentProjects}
                    onSelect={({ row }, event) => openProjectClickAction(event, row.endpointId, row.summary.projectId)}
                    before={chatsRowOf(model)}
                >
                    <OpenFolderItem />
                </ProjectSwitcherGroups>
            </Menu.Popup>
        </Menu.Root>
    );
}

/* The project segment of the toolbar's breadcrumb: projects to switch to, their actions, and opening a folder. */
export function ProjectMenu() {
    const { t } = useTranslation('shell');
    const model = useProjectMenu();
    const { current, currentEndpointId, machine, machineIcon } = model;

    return (
        <>
            <ProjectSwitcher
                // A lone cell's tabs share the row and scroll, so they give way first, not the project's name.
                className="max-w-1/3 shrink-0"
                current={
                    current === null
                        ? null
                        : {
                              id: `${currentEndpointId}:${current.projectId}`,
                              name: current.scratch === true ? t('chats.name') : current.name,
                              icon: (
                                  <ProjectGlyph
                                      projectId={current.projectId}
                                      endpointId={currentEndpointId ?? undefined}
                                      icon={current.icon}
                                      color={current.color}
                                      scratch={current.scratch === true}
                                  />
                              )
                          }
                }
                projects={model.projects}
                recentProjects={model.recentProjects}
                onSelect={({ row }, event) => openProjectClickAction(event, row.endpointId, row.summary.projectId)}
                leading={
                    machine && (
                        <Tooltip label={machine.label}>
                            <span className="flex shrink-0 items-center">
                                <MachineGlyph icon={machineIcon} size={14} className="text-text-muted" />
                            </span>
                        </Tooltip>
                    )
                }
                before={chatsRowOf(model)}
            >
                <OpenFolderItem />
            </ProjectSwitcher>
            {model.dialogs}
        </>
    );
}
