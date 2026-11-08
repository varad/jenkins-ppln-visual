// Interprets the generic statement tree as a Jenkins declarative pipeline.

import { parseCst, stmtArgs, stmtArgValues, stmtName, stmtNamedArgs, tokenValue, type Block, type Statement } from './cst.js';
import type {
  Agent,
  Axis,
  Call,
  Condition,
  Diagnostic,
  Input,
  KV,
  Matrix,
  ParseResult,
  Pipeline,
  Post,
  SourceRange,
  Stage,
  StageBody,
  Step,
  When,
} from './model.js';
import { POST_CONDITIONS } from './model.js';

const PIPELINE_SECTIONS = new Set(['agent', 'environment', 'options', 'parameters', 'triggers', 'tools', 'libraries', 'stages', 'post', 'input']);
const STAGE_SECTIONS = new Set(['agent', 'when', 'input', 'environment', 'options', 'tools', 'post', 'failFast', 'steps', 'stages', 'parallel', 'matrix']);
const MATRIX_SECTIONS = new Set(['axes', 'excludes', 'agent', 'when', 'environment', 'options', 'tools', 'post', 'stages', 'input']);
const BODY_KINDS = ['steps', 'stages', 'parallel', 'matrix'] as const;

/** Above this many cells a matrix is drawn as a single template instead of every cell. */
export const MATRIX_EXPAND_LIMIT = 12;

class Interpreter {
  diagnostics: Diagnostic[] = [];
  private lineStarts: number[] = [0];
  private stageIds = new Set<string>();
  private stageNames = new Map<string, number>();

  constructor(private src: string) {
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
  }

  // ---- locations & diagnostics ----

  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  range(start: number, end: number): SourceRange {
    const line = this.lineOf(start);
    return { start, end, line, col: start - this.lineStarts[line - 1] + 1, endLine: this.lineOf(Math.max(start, end - 1)) };
  }

  loc(s: Statement): SourceRange {
    return this.range(s.start, s.end);
  }

  headLoc(s: Statement): SourceRange {
    const last = s.head[s.head.length - 1];
    return this.range(s.start, last ? last.end : s.end);
  }

  report(severity: Diagnostic['severity'], message: string, loc: SourceRange) {
    this.diagnostics.push({ severity, message, loc });
  }

  text(s: Statement): string {
    return this.src.slice(s.start, s.end);
  }

  headText(s: Statement): string {
    const last = s.head[s.head.length - 1];
    return last ? this.src.slice(s.start, last.end) : '';
  }

  oneLine(s: string, max = 90): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
  }

  // ---- entry ----

  run(): ParseResult {
    const cst = parseCst(this.src);
    for (const issue of cst.issues) this.report(issue.severity, issue.message, this.range(issue.start, issue.end));

    const top = cst.root.statements;
    const pipelineStmt = top.find((s) => stmtName(s) === 'pipeline' && s.closure);
    const preamble: Call[] = top
      .filter((s) => s !== pipelineStmt)
      .map((s) => ({ name: s.head[0]?.text === '@' ? '@' + (s.head[1]?.text ?? '') : s.head[0]?.text ?? '?', raw: this.oneLine(this.headText(s) || this.text(s), 120), loc: this.loc(s) }));

    if (!pipelineStmt) {
      const scripted = top.some((s) => ['node', 'stage', 'parallel', 'timestamps', 'podTemplate'].includes(stmtName(s) ?? ''));
      const where = top[0] ? this.loc(top[0]) : this.range(0, 0);
      if (scripted) {
        this.report('error', 'This looks like a scripted pipeline (node { ... }). Only declarative pipelines (pipeline { ... }) can be visualized.', where);
        return { kind: 'scripted', diagnostics: this.diagnostics, preamble };
      }
      this.report('error', 'No pipeline { ... } block found.', where);
      return { kind: 'unknown', diagnostics: this.diagnostics, preamble };
    }
    if (top.filter((s) => stmtName(s) === 'pipeline').length > 1) this.report('error', 'Only one pipeline block is allowed.', this.loc(pipelineStmt));

    return { kind: 'declarative', pipeline: this.pipeline(pipelineStmt), diagnostics: this.diagnostics, preamble };
  }

  // ---- sections ----

  pipeline(s: Statement): Pipeline {
    const p: Pipeline = { stages: [], loc: this.loc(s) };
    let sawStages = false;
    for (const d of s.closure!.statements) {
      const name = stmtName(d) ?? '';
      if (!PIPELINE_SECTIONS.has(name)) {
        this.report('warning', `Unknown section '${name || this.oneLine(this.text(d), 30)}' in pipeline.`, this.headLoc(d));
        continue;
      }
      switch (name) {
        case 'agent':
          p.agent = this.agent(d);
          break;
        case 'environment':
          p.environment = this.kvs(d);
          break;
        case 'options':
          p.options = this.calls(d);
          break;
        case 'parameters':
          p.parameters = this.calls(d);
          break;
        case 'triggers':
          p.triggers = this.calls(d);
          break;
        case 'tools':
          p.tools = this.tools(d);
          break;
        case 'libraries':
          p.libraries = d.closure ? d.closure.statements.map((l) => stmtArgValues(l).map(tokenValue).join(', ')) : [];
          break;
        case 'stages':
          sawStages = true;
          p.stages = this.stages(d, '', false);
          break;
        case 'post':
          p.post = this.post(d);
          break;
        case 'input':
          this.report('warning', 'input is only allowed inside a stage.', this.headLoc(d));
          break;
      }
    }
    if (!p.agent) this.report('warning', 'The pipeline has no top-level agent. Declarative pipelines require one (use agent none to set it per stage).', this.headLoc(s));
    if (!sawStages) this.report('error', 'The pipeline has no stages section.', this.headLoc(s));
    return p;
  }

  agent(s: Statement): Agent {
    const loc = this.loc(s);
    const raw = this.oneLine(this.text(s), 200);
    const args = stmtArgs(s);
    if (!s.closure) {
      const first = args[0];
      if (first && first.kind === 'ident' && (first.text === 'any' || first.text === 'none')) return { kind: first.text, summary: first.text, raw, loc };
      const vals = stmtArgValues(s).map(tokenValue);
      if (args.some((t) => t.text === 'label')) return { kind: 'label', summary: `label ${vals.join(' ')}`, raw, loc };
      return { kind: 'other', summary: this.oneLine(args.map((t) => t.text).join(' '), 40), raw, loc };
    }
    const inner = s.closure.statements[0];
    const kind = inner ? stmtName(inner) ?? '' : '';
    const innerValue = (st: Statement | undefined, key: string): string | undefined => {
      if (!st) return undefined;
      const direct = stmtArgValues(st)[0];
      if (direct && !st.closure && stmtName(st) !== key) return tokenValue(direct);
      const named = stmtNamedArgs(st, this.src)[key];
      if (named) return named.replace(/^['"]|['"]$/g, '');
      const sub = st.closure?.statements.find((x) => stmtName(x) === key);
      const v = sub && stmtArgValues(sub)[0];
      return v ? tokenValue(v) : undefined;
    };
    switch (kind) {
      case 'label':
        return { kind: 'label', summary: `label ${stmtArgValues(inner).map(tokenValue).join(' ')}`, raw, loc };
      case 'node':
        return { kind: 'node', summary: `node ${innerValue(inner, 'label') ?? ''}`.trim(), raw, loc };
      case 'docker':
        return { kind: 'docker', summary: `docker ${innerValue(inner, 'image') ?? ''}`.trim(), raw, loc };
      case 'dockerfile': {
        const file = innerValue(inner, 'filename');
        return { kind: 'dockerfile', summary: file && file !== 'true' ? `dockerfile ${file}` : 'dockerfile', raw, loc };
      }
      case 'kubernetes':
        return { kind: 'kubernetes', summary: 'kubernetes pod', raw, loc };
      default:
        return { kind: 'other', summary: kind || 'agent', raw, loc };
    }
  }

  kvs(s: Statement): KV[] {
    return (s.closure?.statements ?? []).map((d) => {
      const eq = d.head.findIndex((t) => t.text === '=');
      const key = eq > 0 ? d.head.slice(0, eq).map((t) => t.text).join('') : d.head[0]?.text ?? '?';
      const value = eq > 0 && d.head[eq + 1] ? this.src.slice(d.head[eq + 1].start, d.end) : this.text(d);
      return { key, value: this.oneLine(value, 120), loc: this.loc(d) };
    });
  }

  tools(s: Statement): KV[] {
    return (s.closure?.statements ?? []).map((d) => ({ key: stmtName(d) ?? '?', value: stmtArgValues(d).map(tokenValue).join(', '), loc: this.loc(d) }));
  }

  calls(s: Statement): Call[] {
    return (s.closure?.statements ?? []).map((d) => ({ name: stmtName(d) ?? d.head[0]?.text ?? '?', raw: this.oneLine(this.text(d), 160), loc: this.loc(d) }));
  }

  stages(s: Statement, path: string, nestedInParallel: boolean): Stage[] {
    if (!s.closure) {
      this.report('error', `${stmtName(s)} needs a { ... } block.`, this.headLoc(s));
      return [];
    }
    const out: Stage[] = [];
    for (const d of s.closure.statements) {
      if (stmtName(d) !== 'stage') {
        this.report('error', `Only stage(...) blocks are allowed here, found '${this.oneLine(this.headText(d) || this.text(d), 40)}'.`, this.headLoc(d));
        continue;
      }
      out.push(this.stage(d, path, nestedInParallel));
    }
    if (out.length === 0) this.report('warning', `${stmtName(s)} has no stages.`, this.headLoc(s));
    return out;
  }

  uniqueId(path: string, name: string): string {
    let id = path ? `${path}/${name}` : name;
    if (this.stageIds.has(id)) {
      let n = 2;
      while (this.stageIds.has(`${id}#${n}`)) n++;
      id = `${id}#${n}`;
    }
    this.stageIds.add(id);
    return id;
  }

  stage(s: Statement, path: string, nestedInParallel: boolean, inMatrix = false): Stage {
    const nameTok = stmtArgValues(s)[0];
    const name = nameTok ? tokenValue(nameTok) : '(unnamed)';
    if (!nameTok) this.report('error', 'stage needs a name: stage(\'Name\') { ... }', this.headLoc(s));
    if (!inMatrix) {
      const seen = this.stageNames.get(name) ?? 0;
      if (seen > 0) this.report('error', `Duplicate stage name '${name}'. Stage names must be unique.`, this.headLoc(s));
      this.stageNames.set(name, seen + 1);
    }
    const stage: Stage = {
      id: this.uniqueId(path, name),
      name,
      dynamicName: !!nameTok?.interpolated,
      body: { kind: 'empty' },
      loc: this.loc(s),
      headerLoc: this.headLoc(s),
    };
    if (!s.closure) {
      this.report('error', `stage '${name}' needs a { ... } block.`, this.headLoc(s));
      return stage;
    }
    const bodies: Statement[] = [];
    for (const d of s.closure.statements) {
      const dn = stmtName(d) ?? '';
      if (!STAGE_SECTIONS.has(dn)) {
        const hint = dn === 'stage' ? " Wrap nested stages in a stages { } or parallel { } block (or a '}' is missing above)." : '';
        this.report('error', `'${this.oneLine(this.headText(d) || this.text(d), 40)}' is not allowed directly in stage '${name}'.${hint}`, this.headLoc(d));
        continue;
      }
      switch (dn) {
        case 'agent':
          stage.agent = this.agent(d);
          break;
        case 'when':
          stage.when = this.when(d);
          break;
        case 'input':
          stage.input = this.input(d);
          break;
        case 'environment':
          stage.environment = this.kvs(d);
          break;
        case 'options':
          stage.options = this.calls(d);
          break;
        case 'tools':
          stage.tools = this.tools(d);
          break;
        case 'post':
          stage.post = this.post(d);
          break;
        case 'failFast':
          stage.failFast = stmtArgs(d)[0]?.text === 'true';
          break;
        default:
          bodies.push(d);
      }
    }
    if (bodies.length === 0) {
      this.report('error', `stage '${name}' must contain one of steps, stages, parallel or matrix.`, stage.headerLoc);
    } else {
      if (bodies.length > 1) {
        this.report('error', `stage '${name}' must contain exactly one of steps, stages, parallel or matrix (found ${bodies.map((b) => stmtName(b)).join(', ')}).`, stage.headerLoc);
      }
      stage.body = this.body(bodies[0], stage, nestedInParallel);
    }
    return stage;
  }

  body(d: Statement, stage: Stage, nestedInParallel: boolean): StageBody {
    const kind = stmtName(d) as (typeof BODY_KINDS)[number];
    if ((kind === 'parallel' || kind === 'matrix') && nestedInParallel) {
      this.report('error', `${kind} cannot be used inside a stage that is already within a parallel or matrix block.`, this.headLoc(d));
    }
    switch (kind) {
      case 'steps':
        if (!d.closure) {
          this.report('error', 'steps needs a { ... } block.', this.headLoc(d));
          return { kind: 'steps', steps: [] };
        }
        if (d.closure.statements.length === 0) this.report('warning', `stage '${stage.name}' has empty steps.`, this.headLoc(d));
        return { kind: 'steps', steps: this.steps(d.closure) };
      case 'stages':
        return { kind: 'stages', stages: this.stages(d, stage.id, nestedInParallel) };
      case 'parallel':
        return { kind: 'parallel', branches: this.stages(d, stage.id, true) };
      case 'matrix':
        return { kind: 'matrix', matrix: this.matrix(d, stage.id) };
    }
  }

  steps(b: Block): Step[] {
    return b.statements.map((d) => {
      const name = stmtName(d) ?? d.head[0]?.text ?? '?';
      const isScript = name === 'script';
      const head = this.headText(d);
      const step: Step = {
        name,
        summary: isScript ? 'script { … }' : this.oneLine(d.closure ? `${head} { … }` : this.text(d), 90),
        raw: this.text(d),
        dynamic: isScript,
        loc: this.loc(d),
      };
      if (d.closure && !isScript) step.children = this.steps(d.closure);
      return step;
    });
  }

  when(s: Statement): When {
    const w: When = { conditions: [], summary: '', loc: this.loc(s) };
    for (const d of s.closure?.statements ?? []) {
      const n = stmtName(d);
      if (n === 'beforeAgent' || n === 'beforeInput' || n === 'beforeOptions') {
        w[n] = stmtArgs(d)[0]?.text === 'true';
        continue;
      }
      w.conditions.push(this.condition(d));
    }
    if (w.conditions.length === 0) this.report('warning', 'when has no conditions.', this.headLoc(s));
    w.summary = w.conditions.map((c) => (w.conditions.length > 1 && c.children ? `(${c.summary})` : c.summary)).join(' and ');
    return w;
  }

  condition(d: Statement): Condition {
    const kind = stmtName(d) ?? '?';
    const loc = this.loc(d);
    if ((kind === 'allOf' || kind === 'anyOf' || kind === 'not') && d.closure) {
      const children = d.closure.statements.map((c) => this.condition(c));
      const joiner = kind === 'anyOf' ? ' or ' : ' and ';
      const inner = children.map((c) => (c.children && c.kind !== 'not' ? `(${c.summary})` : c.summary)).join(joiner);
      return { kind, summary: kind === 'not' ? `not ${children.length === 1 && !children[0].children ? inner : `(${inner})`}` : inner, children, loc };
    }
    if (kind === 'expression' && d.closure) {
      return { kind, summary: `expression { ${this.oneLine(this.src.slice(d.closure.start + 1, d.closure.end - 1), 60)} }`, loc };
    }
    return { kind, summary: this.oneLine(this.text(d), 70), loc };
  }

  input(s: Statement): Input {
    const msgStmt = s.closure?.statements.find((d) => stmtName(d) === 'message');
    const v = msgStmt ? stmtArgValues(msgStmt)[0] : stmtArgValues(s)[0];
    return { message: v ? tokenValue(v) : 'Input requested', raw: this.text(s), loc: this.loc(s) };
  }

  post(s: Statement): Post {
    const conditions = (s.closure?.statements ?? []).map((d) => {
      const condition = stmtName(d) ?? '?';
      if (!(POST_CONDITIONS as readonly string[]).includes(condition)) this.report('warning', `Unknown post condition '${condition}'.`, this.headLoc(d));
      return { condition, steps: d.closure ? this.steps(d.closure) : [], loc: this.loc(d) };
    });
    return { conditions, loc: this.loc(s) };
  }

  axis(d: Statement): Axis {
    const ax: Axis = { name: '?', values: [] };
    for (const a of d.closure?.statements ?? []) {
      const n = stmtName(a);
      const vals = stmtArgValues(a).map(tokenValue);
      if (n === 'name') ax.name = vals[0] ?? '?';
      else if (n === 'values') ax.values = vals;
      else if (n === 'notValues') ax.notValues = vals;
    }
    return ax;
  }

  matrix(s: Statement, path: string): Matrix {
    const m: Matrix = { axes: [], excludes: [], cells: [], stages: [], loc: this.loc(s) };
    for (const d of s.closure?.statements ?? []) {
      const n = stmtName(d) ?? '';
      if (!MATRIX_SECTIONS.has(n)) {
        this.report('error', `'${this.oneLine(this.headText(d) || this.text(d), 40)}' is not allowed in matrix.`, this.headLoc(d));
        continue;
      }
      switch (n) {
        case 'axes':
          m.axes = (d.closure?.statements ?? []).filter((a) => stmtName(a) === 'axis').map((a) => this.axis(a));
          break;
        case 'excludes':
          m.excludes = (d.closure?.statements ?? [])
            .filter((e) => stmtName(e) === 'exclude')
            .map((e) => (e.closure?.statements ?? []).filter((a) => stmtName(a) === 'axis').map((a) => this.axis(a)));
          break;
        case 'agent':
          m.agent = this.agent(d);
          break;
        case 'when':
          m.when = this.when(d);
          break;
        case 'environment':
          m.environment = this.kvs(d);
          break;
        case 'options':
          m.options = this.calls(d);
          break;
        case 'tools':
          m.tools = this.tools(d);
          break;
        case 'post':
          m.post = this.post(d);
          break;
        case 'stages':
          if (d.closure) {
            m.stages = d.closure.statements.filter((x) => stmtName(x) === 'stage').map((x) => this.stage(x, path, true, true));
          }
          break;
      }
    }
    if (m.axes.length === 0) this.report('error', 'matrix needs an axes block with at least one axis.', this.headLoc(s));
    if (m.stages.length === 0) this.report('error', 'matrix needs a stages block.', this.headLoc(s));
    m.cells = matrixCells(m.axes, m.excludes);
    return m;
  }
}

/** Cartesian product of the axes minus every combination matched by an exclude. */
export function matrixCells(axes: Axis[], excludes: Axis[][]): Record<string, string>[] {
  let cells: Record<string, string>[] = [{}];
  for (const ax of axes) {
    const next: Record<string, string>[] = [];
    for (const c of cells) for (const v of ax.values) next.push({ ...c, [ax.name]: v });
    cells = next;
  }
  if (axes.length === 0) return [];
  const matches = (cell: Record<string, string>, ex: Axis[]) =>
    ex.length > 0 &&
    ex.every((a) => {
      const v = cell[a.name];
      if (v === undefined) return false;
      if (a.notValues) return !a.notValues.includes(v);
      return a.values.includes(v);
    });
  return cells.filter((c) => !excludes.some((ex) => matches(c, ex)));
}

export function parseJenkinsfile(src: string): ParseResult {
  return new Interpreter(src).run();
}
