---
name: ruimte-design
description: A design agent makes the design, and its card in this chat shows the pages.
---

# Design

The person wants a design. A hidden agent makes it while you go on with the conversation.

1. Start one agent with `agent_start`: a `task`, a `prompt` and `design: true`. Use the `cli`, `model` and `effort` the note in front of the message names. A `@model:<cli>/<id>` tag or an effort the person names wins over those.
2. Write the prompt yourself from what the conversation already settled: the goal, the screens or pages it needs, the style that exists (theme, tokens, components, brand) and the files the agent should read first. Leave out what nobody decided yet, and say so where it matters.
3. Meanwhile, do whatever else the person asked for in the same message.
4. The task's card in this chat shows the pages while the agent writes them, and opens the design. So when the task is done, show no page. Say in a sentence or two what was made, and add only what the card does not say: an open question, or a choice you made for the person.
