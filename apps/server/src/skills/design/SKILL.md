---
name: ruimte-design
description: Has a hidden design agent make the design the person asked for, and shows its main page in this chat as a visual.
---

# Design

The person wants a design. A hidden agent makes it while you go on with the conversation.

1. Start one agent with `agent_start`: a `task`, a `prompt` and `design: true`. Use the `cli`, `model` and `effort` the note in front of the message names. A `@model:<cli>/<id>` tag or an effort the person names wins over those.
2. Write the prompt yourself from what the conversation already settled: the goal, the screens or pages it needs, the style that exists (theme, tokens, components, brand) and the files the agent should read first. Leave out what nobody decided yet, and say so where it matters.
3. Meanwhile, do whatever else the person asked for in the same message.
4. When the task is done, its result names the pages. Show the main page with `visual_show`, passing its path as `design_page` and no `html`. Add only what the page does not say: an open question, a choice you made for the person, a page beside the main one.
