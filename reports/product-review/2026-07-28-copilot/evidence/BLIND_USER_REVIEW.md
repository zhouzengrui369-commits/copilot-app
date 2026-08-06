# Isolated Blind User Reviewer

The reviewer received only a user identity and a task. It did not read project
documents, source, historical reports, the developer thread, or databases. It
used only the current real Electron UI and did not create, delete, or modify
notes, Todos, or settings.

## Frozen finding

`MORE_LIKE_MY_KNOWLEDGE_ASSISTANT_EARLY_FORM / NOT_YET_DEPENDABLE`

## Successful steps

- Found and opened `MSTAR-417 acceptance source` from Today.
- Asked a question that depended on the local source.
- Received the correct `2031-04-17 / amber satellite 62` answer.
- Clicked the source and verified the two facts in the original note.
- Opened the **转为待办** form and confirmed that answer and source were
  carried into it, then stopped before final creation.

## Failed step

After opening the source and returning to Conversations, the current question,
answer, and source state were gone. The reviewer had to ask again.

## Three highest-impact issues

1. Source verification destroys the current conversation state and breaks the
   answer-evidence-action loop.
2. Internal truth/debug labels such as `NOT_PROBED`, `LOCAL_PRESENT`,
   `WIKI CURRENT`, chunk/range/score dominate the user task and conflict with
   one another; a successful answer still coexists with `模型 NOT_PROBED`.
3. The Todo title defaults to the full user question and no sensible due-time
   suggestion is provided, so the output is not yet a crisp next action.

## Trust confusion

The UI simultaneously says the note is `CURRENT` and the folder is
`NOT CURRENT`. A normal user cannot easily tell which scope is safe to trust.
