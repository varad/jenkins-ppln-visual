// A Groovy-aware tokenizer, just deep enough for declarative pipelines.
// It knows Groovy's comments and string forms so that braces inside them never
// confuse the block parser. Everything else is reduced to identifiers, numbers
// and punctuation.

export type TokenKind = 'ident' | 'string' | 'number' | 'punct' | 'eof';

export type StringStyle = 'single' | 'double' | 'triple-single' | 'triple-double' | 'slashy' | 'dollar-slashy';

export interface Token {
  kind: TokenKind;
  /** Exact source text of the token. */
  text: string;
  /** For strings: the content without quotes (escapes left as written). */
  value?: string;
  style?: StringStyle;
  /** True for double-quoted / slashy strings that contain `$` interpolation. */
  interpolated?: boolean;
  start: number;
  end: number;
  line: number; // 1-based
  col: number; // 1-based
  /** True when a newline separates this token from the previous one. */
  nl: boolean;
}

export interface LexError {
  message: string;
  start: number;
  end: number;
}

const PUNCT3 = ['==~', '===', '!==', '<=>', '**=', '...', '?.@', '>>>'];
const PUNCT2 = ['==', '!=', '<=', '>=', '&&', '||', '=~', '->', '?.', '?:', '++', '--', '+=', '-=', '*=', '/=', '<<', '>>', '..', '*.', '.&', '.@', '**'];

export function tokenize(src: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let sawNewline = true;

  const advanceLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (src.charCodeAt(k) === 10) {
        line++;
        lineStart = k + 1;
      }
    }
  };

  const push = (kind: TokenKind, start: number, end: number, extra: Partial<Token> = {}) => {
    tokens.push({ kind, text: src.slice(start, end), start, end, line, col: start - lineStart + 1, nl: sawNewline, ...extra });
    sawNewline = false;
  };

  // A `/` starts a slashy string only where a value is expected.
  const valueExpected = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.kind === 'ident' || prev.kind === 'number' || prev.kind === 'string') {
      // keywords that are followed by an expression
      return prev.kind === 'ident' && ['return', 'in', 'case', 'assert', 'new'].includes(prev.text);
    }
    return !(prev.text === ')' || prev.text === ']' || prev.text === '}');
  };

  // Scans a `${ ... }` interpolation starting at the `{`; returns index after the closing `}`.
  const skipInterpolation = (k: number): number => {
    let depth = 0;
    while (k < src.length) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return k + 1;
      } else if (c === '"' || c === "'") {
        const q = c;
        k++;
        while (k < src.length && src[k] !== q) k += src[k] === '\\' ? 2 : 1;
      }
      k++;
    }
    return k;
  };

  while (i < src.length) {
    const c = src[i];
    const start = i;

    // whitespace
    if (c === '\n') {
      sawNewline = true;
      line++;
      lineStart = i + 1;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    // line continuation
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
      i += src[i + 1] === '\n' ? 2 : 3;
      line++;
      lineStart = i;
      continue;
    }
    // shebang
    if (i === 0 && c === '#' && src[1] === '!') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // comments
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close < 0 ? src.length : close + 2;
      if (close < 0) errors.push({ message: 'Unterminated block comment', start, end });
      if (src.slice(i, end).includes('\n')) sawNewline = true;
      advanceLines(i, end);
      i = end;
      continue;
    }

    // strings
    if (c === "'" || c === '"') {
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let k = i + q.length;
      let interpolated = false;
      let closed = false;
      while (k < src.length) {
        if (src[k] === '\\') {
          k += 2;
          continue;
        }
        if (c === '"' && src[k] === '$') {
          interpolated = true;
          if (src[k + 1] === '{') {
            k = skipInterpolation(k + 1);
            continue;
          }
        }
        if (src.startsWith(q, k)) {
          closed = true;
          k += q.length;
          break;
        }
        if (!triple && src[k] === '\n') break;
        k++;
      }
      if (!closed) errors.push({ message: 'Unterminated string', start, end: k });
      const style: StringStyle = triple ? (c === "'" ? 'triple-single' : 'triple-double') : c === "'" ? 'single' : 'double';
      push('string', start, k, { value: src.slice(start + q.length, closed ? k - q.length : k), style, interpolated });
      advanceLines(start, k);
      i = k;
      continue;
    }
    if (c === '$' && src[i + 1] === '/') {
      const close = src.indexOf('/$', i + 2);
      const end = close < 0 ? src.length : close + 2;
      if (close < 0) errors.push({ message: 'Unterminated dollar-slashy string', start, end });
      const value = src.slice(i + 2, close < 0 ? end : close);
      push('string', start, end, { value, style: 'dollar-slashy', interpolated: value.includes('$') });
      advanceLines(start, end);
      i = end;
      continue;
    }
    if (c === '/' && valueExpected() && src[i + 1] !== '=') {
      let k = i + 1;
      while (k < src.length && src[k] !== '/') {
        if (src[k] === '\\') k++;
        k++;
      }
      const end = Math.min(k + 1, src.length);
      const value = src.slice(i + 1, k);
      push('string', start, end, { value, style: 'slashy', interpolated: value.includes('$') });
      advanceLines(start, end);
      i = end;
      continue;
    }

    // identifiers (incl. $ and unicode letters)
    if (/[A-Za-z_$À-￿]/.test(c)) {
      let k = i + 1;
      while (k < src.length && /[A-Za-z0-9_$À-￿]/.test(src[k])) k++;
      push('ident', start, k);
      i = k;
      continue;
    }
    // numbers
    if (/[0-9]/.test(c)) {
      let k = i + 1;
      while (k < src.length && /[0-9A-Za-z_.]/.test(src[k])) {
        if (src[k] === '.' && !/[0-9]/.test(src[k + 1] ?? '')) break;
        k++;
      }
      push('number', start, k);
      i = k;
      continue;
    }
    // punctuation
    const p3 = PUNCT3.find((p) => src.startsWith(p, i));
    const p2 = p3 ? undefined : PUNCT2.find((p) => src.startsWith(p, i));
    const len = p3 ? 3 : p2 ? 2 : 1;
    push('punct', start, i + len);
    i += len;
  }
  tokens.push({ kind: 'eof', text: '', start: src.length, end: src.length, line, col: src.length - lineStart + 1, nl: true });
  return { tokens, errors };
}
