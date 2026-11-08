// Generic "command + closure" tree for Groovy DSL code.
// Every statement is a run of tokens, optionally ending in a `{ ... }` closure.
// That is exactly the shape of a declarative Jenkinsfile:
//   stage('Build') { steps { sh 'make' } }
// The declarative interpreter (declarative.ts) gives the tree its meaning.

import { tokenize, type Token, type LexError } from './lexer.js';

export interface Statement {
  /** Tokens before the trailing closure (the command and its arguments). */
  head: Token[];
  /** The trailing `{ ... }` closure, if any. */
  closure?: Block;
  start: number;
  end: number;
  line: number;
  col: number;
}

export interface Block {
  statements: Statement[];
  start: number; // offset of `{` (or 0 for the file)
  end: number; // offset after `}`
  closed: boolean;
}

export interface ParseIssue {
  message: string;
  start: number;
  end: number;
  severity: 'error' | 'warning' | 'info';
}

const CONTINUE_AFTER = new Set([',', '(', '[', '+', '-', '*', '/', '%', '&&', '||', '=', ':', '?', '.', '?.', '==', '!=', '->', '=~', '==~', '<', '>', '<=', '>=', '+=', '-=', '?:', '!', '&', '|', '<<']);
const CONTINUE_BEFORE = new Set(['.', '?.', '*.', ')', ']', '&&', '||', '?', ':', '?:', '+']);

class Parser {
  private i = 0;
  issues: ParseIssue[] = [];
  constructor(private tokens: Token[], private recovery: boolean) {}

  private peek(o = 0) {
    return this.tokens[Math.min(this.i + o, this.tokens.length - 1)];
  }

  parseFile(): Block {
    const statements = this.parseStatements(false, 0);
    const last = this.tokens[this.tokens.length - 1];
    return { statements, start: 0, end: last.end, closed: true };
  }

  private parseStatements(inBraces: boolean, openerCol: number): Statement[] {
    const out: Statement[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') return out;
      if (t.kind === 'punct' && t.text === ';') {
        this.i++;
        continue;
      }
      if (t.kind === 'punct' && t.text === '}') {
        if (inBraces) return out;
        this.issues.push({ message: "Unexpected '}'", start: t.start, end: t.end, severity: 'error' });
        this.i++;
        continue;
      }
      if (this.recovery && inBraces && t.nl && t.col <= openerCol) return out; // indentation says this block ended
      const before = this.i;
      out.push(this.parseStatement());
      if (this.i === before) this.i++; // safety: always make progress
    }
  }

  private parseStatement(): Statement {
    const first = this.peek();
    const head: Token[] = [];
    let closure: Block | undefined;
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') break;
      if (depth === 0) {
        if (t.kind === 'punct' && (t.text === ';' || t.text === '}')) break;
        if (t.nl && head.length > 0 && !closure) {
          const prev = head[head.length - 1];
          if (!(prev.kind === 'punct' && CONTINUE_AFTER.has(prev.text)) && !(t.kind === 'punct' && CONTINUE_BEFORE.has(t.text))) break;
        }
        if (closure) {
          // Only `,` or a method chain may follow a trailing closure.
          if (!(t.kind === 'punct' && [',', '.', '?.'].includes(t.text)) || t.nl) break;
          closure = undefined; // closure was an argument, keep scanning (rare in declarative)
        }
        if (t.kind === 'punct' && t.text === '{') {
          closure = this.parseClosure(first.col);
          continue;
        }
      }
      if (t.kind === 'punct') {
        if (t.text === '(' || t.text === '[' || (depth > 0 && t.text === '{')) depth++;
        else if (t.text === ')' || t.text === ']' || (depth > 0 && t.text === '}')) {
          depth--;
          if (depth < 0) {
            this.issues.push({ message: `Unexpected '${t.text}'`, start: t.start, end: t.end, severity: 'error' });
            depth = 0;
          }
        }
      }
      if (this.recovery && depth > 0 && t.nl && t.col <= first.col) {
        // An unclosed bracket swallowed the next statement; stop here.
        this.issues.push({ message: 'Unclosed bracket', start: first.start, end: head[head.length - 1]?.end ?? first.end, severity: 'error' });
        break;
      }
      head.push(t);
      this.i++;
    }
    const lastTok = head[head.length - 1];
    const end = closure ? closure.end : lastTok ? lastTok.end : first.end;
    if (depth > 0 && !this.recovery) {
      this.issues.push({ message: 'Unclosed bracket', start: first.start, end, severity: 'error' });
    }
    return { head, closure, start: first.start, end, line: first.line, col: first.col };
  }

  private parseClosure(openerCol: number): Block {
    const open = this.peek();
    this.i++; // '{'
    const statements = this.parseStatements(true, openerCol);
    const t = this.peek();
    if (t.kind === 'punct' && t.text === '}') {
      this.i++;
      return { statements, start: open.start, end: t.end, closed: true };
    }
    this.issues.push({ message: "Missing '}' for this block", start: open.start, end: open.end, severity: 'error' });
    const lastEnd = statements.length ? statements[statements.length - 1].end : open.end;
    return { statements, start: open.start, end: lastEnd, closed: false };
  }
}

export interface CstResult {
  root: Block;
  tokens: Token[];
  issues: ParseIssue[];
  recovered: boolean;
}

/** Parses source into the generic tree. Retries with indentation-based recovery when braces don't balance. */
export function parseCst(src: string): CstResult {
  const { tokens, errors } = tokenize(src);
  const lexIssues: ParseIssue[] = errors.map((e: LexError) => ({ ...e, severity: 'error' as const }));
  const strict = new Parser(tokens, false);
  const root = strict.parseFile();
  if (strict.issues.length === 0) return { root, tokens, issues: lexIssues, recovered: false };
  const loose = new Parser(tokens, true);
  const root2 = loose.parseFile();
  return { root: root2, tokens, issues: [...lexIssues, ...dedupe(loose.issues.length ? loose.issues : strict.issues)], recovered: true };
}

function dedupe(issues: ParseIssue[]): ParseIssue[] {
  const seen = new Set<string>();
  return issues.filter((x) => {
    const k = `${x.start}:${x.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---- helpers used by the interpreter ----

export function stmtName(s: Statement): string | undefined {
  const t = s.head[0];
  return t && t.kind === 'ident' ? t.text : undefined;
}

/** Argument tokens after the command name, without one pair of wrapping parentheses. */
export function stmtArgs(s: Statement): Token[] {
  let args = s.head.slice(1);
  if (args.length >= 2 && args[0].text === '(' && args[args.length - 1].text === ')') args = args.slice(1, -1);
  return args;
}

/** String-literal (and number / boolean) argument values at the top level of the argument list. */
export function stmtArgValues(s: Statement): Token[] {
  const out: Token[] = [];
  let depth = 0;
  const args = stmtArgs(s);
  for (let k = 0; k < args.length; k++) {
    const t = args[k];
    if (t.kind === 'punct' && ['(', '[', '{'].includes(t.text)) depth++;
    else if (t.kind === 'punct' && [')', ']', '}'].includes(t.text)) depth--;
    else if (depth <= 1 && (t.kind === 'string' || t.kind === 'number' || (t.kind === 'ident' && (t.text === 'true' || t.text === 'false')))) {
      // skip named-argument keys like `name: 'x'` -> keep the value only
      if (args[k + 1]?.text === ':') continue;
      out.push(t);
    }
  }
  return out;
}

/** Named arguments `key: value` at the top level (values as source text). */
export function stmtNamedArgs(s: Statement, src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const args = stmtArgs(s);
  let depth = 0;
  for (let k = 0; k < args.length; k++) {
    const t = args[k];
    if (t.kind === 'punct' && ['(', '[', '{'].includes(t.text)) depth++;
    else if (t.kind === 'punct' && [')', ']', '}'].includes(t.text)) depth--;
    else if (depth === 0 && (t.kind === 'ident' || t.kind === 'string') && args[k + 1]?.text === ':') {
      // value runs until the next top-level comma
      let d = 0;
      let j = k + 2;
      const startTok = args[j];
      let endTok = startTok;
      while (j < args.length) {
        const u = args[j];
        if (u.kind === 'punct' && ['(', '[', '{'].includes(u.text)) d++;
        else if (u.kind === 'punct' && [')', ']', '}'].includes(u.text)) d--;
        else if (d === 0 && u.text === ',') break;
        endTok = u;
        j++;
      }
      if (startTok) out[t.kind === 'string' ? t.value ?? t.text : t.text] = src.slice(startTok.start, endTok.end);
      k = j;
    }
  }
  return out;
}

export function tokenValue(t: Token): string {
  return t.kind === 'string' ? t.value ?? '' : t.text;
}
