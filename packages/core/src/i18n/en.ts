// English messages: the source catalog every other locale must match key for key.
// `{name}` is a placeholder. A plural message picks its form by the `n` parameter, using the locale's
// plural rules (Intl.PluralRules); forms a locale doesn't list fall back to `other`.
// Jenkins syntax (pipeline { … }, steps, stages, parallel, matrix, when, input, agent, post) stays untranslated.

export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | PluralMessage;

export const en = {
  // ---- parser diagnostics ----
  'lex.unterminatedComment': 'Unterminated block comment',
  'lex.unterminatedString': 'Unterminated string',
  'lex.unterminatedDollarSlashy': 'Unterminated dollar-slashy string',
  'cst.unexpectedBrace': "Unexpected '}'",
  'cst.unexpectedToken': "Unexpected '{token}'",
  'cst.unclosedBracket': 'Unclosed bracket',
  'cst.missingBrace': "Missing '}' for this block",
  'diag.scripted': 'This looks like a scripted pipeline (node { ... }). Only declarative pipelines (pipeline { ... }) can be visualized.',
  'diag.noPipeline': 'No pipeline { ... } block found.',
  'diag.multiplePipelines': 'Only one pipeline block is allowed.',
  'diag.unknownSection': "Unknown section '{name}' in pipeline.",
  'diag.inputOutsideStage': 'input is only allowed inside a stage.',
  'diag.noAgent': 'The pipeline has no top-level agent. Declarative pipelines require one (use agent none to set it per stage).',
  'diag.noStages': 'The pipeline has no stages section.',
  'diag.needsBlock': '{name} needs a { ... } block.',
  'diag.onlyStagesAllowed': "Only stage(...) blocks are allowed here, found '{found}'.",
  'diag.emptyStages': '{name} has no stages.',
  'diag.stageNeedsName': "stage needs a name: stage('Name') { ... }",
  'diag.duplicateStage': "Duplicate stage name '{name}'. Stage names must be unique.",
  'diag.stageNeedsBlock': "stage '{name}' needs a { ... } block.",
  'diag.notAllowedInStage': "'{found}' is not allowed directly in stage '{name}'.",
  'diag.nestedStageHint': "'{found}' is not allowed directly in stage '{name}'. Wrap nested stages in a stages { } or parallel { } block (or a '}' is missing above).",
  'diag.stageNoBody': "stage '{name}' must contain one of steps, stages, parallel or matrix.",
  'diag.stageManyBodies': "stage '{name}' must contain exactly one of steps, stages, parallel or matrix (found {found}).",
  'diag.nestedParallel': '{kind} cannot be used inside a stage that is already within a parallel or matrix block.',
  'diag.emptySteps': "stage '{name}' has empty steps.",
  'diag.whenNoConditions': 'when has no conditions.',
  'diag.unknownPost': "Unknown post condition '{name}'.",
  'diag.notAllowedInMatrix': "'{found}' is not allowed in matrix.",
  'diag.matrixNoAxes': 'matrix needs an axes block with at least one axis.',
  'diag.matrixNoStages': 'matrix needs a stages block.',

  // ---- stage renaming ----
  'rename.notRenamable': 'This stage cannot be renamed.',
  'rename.empty': 'A stage needs a name.',
  'rename.multiline': 'A stage name must fit on one line.',
  'rename.unchanged': 'The name is unchanged.',
  'rename.taken': "Another stage is already named '{name}'.",

  // ---- diagram ----
  'graph.start': 'Start',
  'graph.end': 'End',
  'graph.steps': { one: '{n} step', other: '{n} steps' },
  'graph.failFast': 'Stop other branches when one fails',
  'graph.script': 'Contains script { } blocks: imperative Groovy, shown but not evaluated',
  'graph.matrix': { one: 'matrix {dims} → {n} cell', other: 'matrix {dims} → {n} cells' },
  'graph.eachCell': { one: 'each of {n} cell', other: 'each of {n} cells' },
  'graph.mermaidMatrix': { one: 'matrix, {n} cell', other: 'matrix, {n} cells' },
  'graph.inputDefault': 'Input requested',

  // ---- viewer ----
  'ui.title': 'Jenkinsfile Visualizer',
  'ui.language': 'Language',
  'ui.sample': 'Sample',
  'ui.yourFile': '(your file)',
  'ui.openFile': 'Open file…',
  'ui.scripted': 'Scripted pipeline',
  'ui.errors': { one: '{n} error', other: '{n} errors' },
  'ui.warnings': { one: '{n} warning', other: '{n} warnings' },
  'ui.stages': { one: '{n} stage', other: '{n} stages' },
  'ui.wrap': 'Wrap',
  'ui.wrapTitle': 'Wrap the diagram to the width of the preview',
  'ui.copyMermaid': 'Copy Mermaid',
  'ui.mermaidCopied': 'Mermaid copied to clipboard',
  'ui.downloadSvg': 'Download SVG',
  'ui.severity.error': 'error',
  'ui.severity.warning': 'warning',
  'ui.severity.info': 'info',
  'ui.lineShort': 'L{line}',
  'ui.scriptedTitle': 'This is a scripted pipeline',
  'ui.scriptedBody': 'Scripted pipelines (node { … }) are plain Groovy programs, so their stages are only known when they run. Only declarative pipelines (pipeline { … }) can be drawn.',
  'ui.noneTitle': 'No declarative pipeline found',
  'ui.noneBody': 'Paste a Jenkinsfile that starts with pipeline { … }, open a file, or drop one here.',
  'ui.noneBodyEmbed': 'Only files with a declarative pipeline { … } block can be drawn.',
  'ui.dropHint': 'Drop a Jenkinsfile to visualize it',
  'ui.trash': '🗑 Drop here to remove',
  'ui.stageName': 'Stage name',
  'ui.undoMove': 'Move Stage',
  'ui.undoRemove': 'Remove Stage',
  'ui.undoRename': 'Rename Stage',

  // ---- details pane ----
  'details.pipeline': 'Pipeline',
  'details.nothing': 'Nothing to show yet.',
  'details.hint': 'Click a stage to see its details and jump to its source.',
  'details.line': 'line {line}',
  'details.dynamicName': 'name is interpolated at run time',
  'details.agent': 'Agent',
  'details.when': 'Runs only when',
  'details.evaluated': 'Evaluated {flags}.',
  'details.beforeAgent': 'before agent',
  'details.beforeInput': 'before input',
  'details.beforeOptions': 'before options',
  'details.whenNote': 'Conditions are evaluated by Jenkins at run time; they are shown, not evaluated, here.',
  'details.dynamicStep': 'Imperative Groovy: shown, not evaluated',
  'details.input': 'Waits for input',
  'details.environment': 'Environment',
  'details.options': 'Options',
  'details.tools': 'Tools',
  'details.steps': 'Steps',
  'details.post': 'Post',
  'details.matrixAxes': 'Matrix axes',
  'details.excludes': { one: '{n} exclude rule', other: '{n} exclude rules' },
  'details.cellsRun': { one: '{n} cell runs.', other: '{n} cells run.' },
  'details.parameters': 'Parameters',
  'details.triggers': 'Triggers',
  'details.preamble': 'Outside the pipeline block',
} satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, Message>;
