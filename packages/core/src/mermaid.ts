// Mermaid flowchart export, for READMEs and pull requests (GitHub renders it natively).

import { MATRIX_EXPAND_LIMIT } from './declarative.js';
import type { Pipeline, Stage } from './model.js';

const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/[<>]/g, (c) => (c === '<' ? '#lt;' : '#gt;'));

export function toMermaid(p: Pipeline): string {
  const lines: string[] = ['flowchart LR'];
  let n = 0;
  const next = () => `n${n++}`;
  const conditional: string[] = [];

  const sequence = (stages: Stage[], indent: string): { first?: string; last?: string } => {
    let first: string | undefined;
    let prev: string | undefined;
    for (const s of stages) {
      const id = stage(s, indent);
      if (prev) lines.push(`${indent}${prev} --> ${id}`);
      else first = id;
      prev = id;
    }
    return { first, last: prev };
  };

  function stage(s: Stage, indent: string): string {
    const id = next();
    if (s.when) conditional.push(id);
    const tag = s.when ? ' ⟨when⟩' : '';
    switch (s.body.kind) {
      case 'steps':
      case 'empty':
        lines.push(`${indent}${id}["${esc(s.name)}${tag}"]`);
        return id;
      case 'stages':
        lines.push(`${indent}subgraph ${id}["${esc(s.name)}${tag}"]`, `${indent}  direction LR`);
        sequence(s.body.stages, indent + '  ');
        lines.push(`${indent}end`);
        return id;
      case 'parallel':
        lines.push(`${indent}subgraph ${id}["${esc(s.name)} (parallel)${tag}"]`, `${indent}  direction TB`);
        for (const b of s.body.branches) stage(b, indent + '  ');
        lines.push(`${indent}end`);
        return id;
      case 'matrix': {
        const m = s.body.matrix;
        lines.push(`${indent}subgraph ${id}["${esc(s.name)} (matrix, ${m.cells.length} cells)${tag}"]`, `${indent}  direction TB`);
        const cells = m.cells.length <= MATRIX_EXPAND_LIMIT ? m.cells.map((c) => Object.values(c).join(' · ')) : [`each of ${m.cells.length} cells`];
        for (const c of cells) {
          const cid = next();
          lines.push(`${indent}  ${cid}["${esc(c)}: ${esc(m.stages.map((x) => x.name).join(' → '))}"]`);
        }
        lines.push(`${indent}end`);
        return id;
      }
    }
  }

  lines.push('  start((Start))');
  const { first, last } = sequence(p.stages, '  ');
  if (first) lines.push(`  start --> ${first}`);
  let tail = last ?? 'start';
  if (p.post?.conditions.length) {
    lines.push(`  post[/"post: ${esc(p.post.conditions.map((c) => c.condition).join(', '))}"/]`);
    lines.push(`  ${tail} -.-> post`);
    tail = 'post';
  }
  lines.push('  finish((End))', `  ${tail} --> finish`);
  if (conditional.length) {
    lines.push('  classDef when stroke-dasharray: 5 4');
    lines.push(`  class ${conditional.join(',')} when`);
  }
  return lines.join('\n') + '\n';
}
