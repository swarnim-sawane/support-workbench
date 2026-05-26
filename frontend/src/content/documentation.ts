export interface DocumentationSection {
  id: string;
  title: string;
  summary: string;
  content: string;
  icon: 'workflow' | 'commands' | 'uploads' | 'reports' | 'shield' | 'integration' | 'route' | 'notes';
}

export const documentationIntro = {
  eyebrow: 'Tool Guide',
  title: 'Support Workbench Documentation',
  lead:
    'Use this guide when you need a faster path from raw diagnostic evidence to a clear support explanation and next action.',
  note:
    'Support Workbench is a guided diagnostic workspace for engineers and support teams who need to combine chat, files, reports, approvals, and local tools in one investigation.'
};

export const documentationHighlights = [
  {
    label: 'Best for',
    value: 'ADF, Forms, Reports, HAR, thread dump, log, and workspace investigations that need a repeatable support flow.'
  },
  {
    label: 'Inputs',
    value: 'Uploaded logs, ZIP bundles, HAR files, screenshots, workspace files, command prompts, and reusable session sources.'
  },
  {
    label: 'Outcome',
    value: 'A focused chat transcript, attached evidence, generated reports, and a handoff-ready summary of what changed or failed.'
  }
];

export const documentationSections: DocumentationSection[] = [
  {
    id: 'what-support-workbench-does',
    title: 'What Support Workbench does',
    summary: 'A plain-language view of the tool and the support sessions it is built for.',
    icon: 'workflow',
    content: `
Support Workbench helps you move from **"something broke"** to **"this is the likely evidence and next step"** without rebuilding the investigation from scratch each time.

It combines a diagnostic chat, file uploads, guided slash commands, generated reports, session history, and safe tool approvals in one browser workspace.

Use it when you need to:

- explain a failed session to another engineer
- inspect logs, traces, HAR files, or workspaces with a guided flow
- keep source files and analysis output attached to the same conversation
- produce a concise handoff with enough evidence for the next owner
- ask follow-up questions after an automated diagnostic run
`
  },
  {
    id: 'slash-command-workflows',
    title: 'Slash-command workflows',
    summary: 'How the guided command layer turns common support tasks into repeatable flows.',
    icon: 'commands',
    content: `
Slash commands are the fastest way to start a structured investigation.

Common entry points include:

- \`/commands\` to list the command set exposed by the current runtime
- \`/report\` to force the configured report path when the selected evidence supports it
- \`/session\` to inspect the current session metadata and runtime state
- \`/diff\` to review tracked workspace changes from the runtime
- \`/skills\` and \`/config\` to inspect local integrations when diagnosing environment setup
- \`/compact\` when a long conversation needs to be condensed for later continuation

The help drawer reads from the runtime command catalog, so it should only advertise commands the current workbench actually exposes.
`
  },
  {
    id: 'uploads-and-session-sources',
    title: 'Uploads and session sources',
    summary: 'How files, attachments, and workspace context become reusable evidence.',
    icon: 'uploads',
    content: `
Upload files when the evidence should travel with the session.

The workbench supports individual files, screenshots, text logs, and ZIP bundles. Uploaded items appear in the workspace panel and can be added to later chat prompts without re-uploading them.

Good habits:

- upload the smallest bundle that still explains the issue
- keep related files in the same session when they describe the same user action
- use slash commands only when the runtime exposes a command that matches the workflow
- remove unrelated attachments before asking for a focused summary

Workspace context is separate from uploaded evidence. It helps the assistant understand local files and diffs, while uploads represent the diagnostic sources you want analyzed.
`
  },
  {
    id: 'reports-and-handoffs',
    title: 'Reports, artifacts, and handoffs',
    summary: 'Where generated report output appears and how to use it in support communication.',
    icon: 'reports',
    content: `
Some workflows can produce HTML reports or structured artifacts. These appear in the workspace panel and inside the runtime trace for the turn that generated them.

Use reports when you need:

- a shareable diagnostic artifact
- a deeper analyzer output than a short chat answer
- a durable reference for the issue timeline
- evidence that can be reviewed outside the live chat

For handoff, combine the relevant report, the filtered source files, and a short chat summary that names the suspected root cause, confidence level, and next owner.
`
  },
  {
    id: 'approval-flow',
    title: 'Approval flow and safe execution',
    summary: 'How tool approvals keep local actions visible and deliberate.',
    icon: 'shield',
    content: `
Support Workbench can ask for approval before local tools or write actions run.

Approval cards show what the assistant wants to do, why it wants to do it, and the input it plans to send. You can allow or deny the request before the session continues.

Use approvals as a checkpoint:

- allow read-only diagnostic actions when the source and reason make sense
- deny actions that target the wrong file, folder, or session
- review write actions carefully before accepting them
- keep generated reports and uploaded files tied to the session that created them

The goal is not to slow down the workflow. The goal is to make local execution inspectable before it changes anything important.
`
  },
  {
    id: 'oca-and-specialized-tools',
    title: 'OCA and focused analyzers',
    summary: 'What the model and diagnostic bridge do at a user-facing level.',
    icon: 'integration',
    content: `
The workbench uses an OCA-compatible model provider for chat and reasoning.

When focused analyzers are available, the composer only shows **Focus** after the files added to chat match an enabled analyzer. If nothing matches, there is no extra control to think about: ask normally and the assistant uses direct file analysis.

In normal use:

- the model explains, summarizes, and chooses next diagnostic steps
- local tools inspect files, session state, and workspace context
- focused analyzers provide deeper product-specific artifacts when configured
- the health pill and runtime trace help show what path was used

The Help drawer lists the analyzer bridge catalog reported by the runtime, including prerequisite reasons such as missing analyzer root, missing Java/JDTOOLS configuration, missing jdtools.jar, or missing FORMS_HOME.

Use **Focus** when you specifically want to steer the answer through an enabled analyzer, such as:

- access logs
- ADF/ODL logs
- ADF performance logs
- JBO activity
- JDBC leak dumps
- Forms traces
- thread dumps
- JDeveloper workspaces
- ADR incident folders

HAR analysis and HAR-to-log correlation remain available through the normal chat and support commands where configured, but they are not shown as Focus options unless the runtime advertises a matching analyzer for the selected evidence.

If an artifact was not generated, the session should explain whether the analyzer was unavailable, skipped, or not relevant for that source.
`
  },
  {
    id: 'recommended-workflow',
    title: 'Recommended troubleshooting workflow',
    summary: 'A repeatable order of operations for slow, broken, or ambiguous support cases.',
    icon: 'route',
    content: `
Use this flow when a support case starts with incomplete or noisy evidence:

1. Start a new chat for the issue or select the existing session for the same case
2. Upload the smallest useful evidence bundle
3. Add the relevant files to chat, ask a focused question, and use Focus only if it appears for that evidence
4. Review approvals and generated runtime events before continuing
5. Open any report artifact and confirm it matches the uploaded source
6. Ask a focused follow-up question, such as "what is the strongest evidence for the root cause?"
7. Export or summarize the chat only after the noisy parts of the investigation are filtered down

This keeps the session readable and makes later handoff easier.
`
  },
  {
    id: 'practical-notes',
    title: 'Practical notes and limitations',
    summary: 'Small details that prevent avoidable dead ends during support investigations.',
    icon: 'notes',
    content: `
Keep these points in mind:

- AI summaries are strongest after the source set is narrowed
- very large ZIPs or logs can take longer to process
- generated reports depend on the relevant analyzer being available
- screenshots can help when the visible UI error is important context
- session history is useful for returning to prior work, but each support case should still keep a clean evidence set
- sensitive diagnostic bundles should be reviewed before wider sharing

When the result is still ambiguous, hand off the smallest useful package: relevant uploads, the generated report if one exists, and a short explanation of the user action that triggered the issue.
`
  }
];

export const documentationCta = {
  title: 'Ready to investigate a support case?',
  body:
    'Return to the workbench when you are ready to upload evidence, run a guided command, or ask a focused follow-up question.'
};
