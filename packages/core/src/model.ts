// The declarative pipeline model. Shapes follow the Jenkins declarative grammar
// (https://www.jenkins.io/doc/book/pipeline/syntax/) and stay close to what
// Jenkins' own pipeline-model-converter emits, so a converter adapter is easy later.

export interface SourceRange {
  start: number;
  end: number;
  line: number;
  col: number;
  endLine: number;
}

export interface Diagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info';
  loc: SourceRange;
}

export type AgentKind = 'any' | 'none' | 'label' | 'node' | 'docker' | 'dockerfile' | 'kubernetes' | 'other';

export interface Agent {
  kind: AgentKind;
  /** Short human-readable summary, e.g. `label linux` or `docker node:20`. */
  summary: string;
  raw: string;
  loc: SourceRange;
}

export interface KV {
  key: string;
  value: string;
  loc: SourceRange;
}

/** A directive call such as `timeout(time: 30, unit: 'MINUTES')` or `booleanParam(...)`. */
export interface Call {
  name: string;
  raw: string;
  loc: SourceRange;
}

export interface Step {
  name: string;
  /** One-line summary of the step, e.g. `sh 'make build'`. */
  summary: string;
  raw: string;
  /** `script {}` and steps with interpolated arguments cannot be fully known statically. */
  dynamic: boolean;
  /** Steps wrapped by block steps like `dir('x') { ... }` or `withCredentials(...) { ... }`. */
  children?: Step[];
  loc: SourceRange;
}

export interface Condition {
  /** branch, expression, allOf, anyOf, not, ... */
  kind: string;
  summary: string;
  children?: Condition[];
  loc: SourceRange;
}

export interface When {
  conditions: Condition[];
  /** Human-readable summary of all conditions (implicitly AND-ed). */
  summary: string;
  beforeAgent?: boolean;
  beforeInput?: boolean;
  beforeOptions?: boolean;
  loc: SourceRange;
}

export const POST_CONDITIONS = ['always', 'changed', 'fixed', 'regression', 'aborted', 'failure', 'success', 'unstable', 'unsuccessful', 'cleanup'] as const;
export type PostConditionName = (typeof POST_CONDITIONS)[number];

export interface PostCondition {
  condition: PostConditionName | string;
  steps: Step[];
  loc: SourceRange;
}

export interface Post {
  conditions: PostCondition[];
  loc: SourceRange;
}

export interface Input {
  message: string;
  raw: string;
  loc: SourceRange;
}

export interface Axis {
  name: string;
  values: string[];
  /** Only in excludes: `notValues` instead of `values`. */
  notValues?: string[];
}

export interface Matrix {
  axes: Axis[];
  excludes: Axis[][];
  /** Every combination of axis values left after excludes. */
  cells: Record<string, string>[];
  agent?: Agent;
  when?: When;
  environment?: KV[];
  options?: Call[];
  tools?: KV[];
  post?: Post;
  stages: Stage[];
  loc: SourceRange;
}

export type StageBody =
  | { kind: 'steps'; steps: Step[] }
  | { kind: 'stages'; stages: Stage[] }
  | { kind: 'parallel'; branches: Stage[] }
  | { kind: 'matrix'; matrix: Matrix }
  | { kind: 'empty' };

export interface Stage {
  /** Unique id within the pipeline (path of names). */
  id: string;
  name: string;
  /** True when the stage name is an interpolated GString like "Deploy ${env.X}". */
  dynamicName: boolean;
  agent?: Agent;
  when?: When;
  input?: Input;
  environment?: KV[];
  options?: Call[];
  tools?: KV[];
  failFast?: boolean;
  post?: Post;
  body: StageBody;
  loc: SourceRange;
  /** Range of just the `stage('name')` header, for highlighting. */
  headerLoc: SourceRange;
}

export interface Pipeline {
  agent?: Agent;
  environment?: KV[];
  options?: Call[];
  parameters?: Call[];
  triggers?: Call[];
  tools?: KV[];
  libraries?: string[];
  stages: Stage[];
  post?: Post;
  loc: SourceRange;
}

export interface ParseResult {
  /** `declarative` when a pipeline block was found; `scripted` for node {} style files. */
  kind: 'declarative' | 'scripted' | 'unknown';
  pipeline?: Pipeline;
  diagnostics: Diagnostic[];
  /** Code outside `pipeline {}` (defs, @Library, functions) — kept for display. */
  preamble: Call[];
}
