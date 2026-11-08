import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseJenkinsfile } from '../src/declarative.js';
import type { Stage } from '../src/model.js';

const FIXTURES = join(__dirname, '../../../fixtures');
const read = (rel: string) => readFileSync(join(FIXTURES, rel), 'utf8');

/** Compact outline of the stage tree for readable snapshots. */
function outline(stages: Stage[], indent = ''): string[] {
  const lines: string[] = [];
  for (const s of stages) {
    const tags = [
      s.body.kind,
      s.agent && `agent=${s.agent.summary}`,
      s.when && `when=${s.when.summary}`,
      s.input && `input=${s.input.message}`,
      s.post && `post=${s.post.conditions.map((c) => c.condition).join('/')}`,
      s.failFast && 'failFast',
      s.dynamicName && 'dynamicName',
    ].filter(Boolean);
    lines.push(`${indent}${s.name} [${tags.join('; ')}]`);
    if (s.body.kind === 'steps') for (const st of s.body.steps) lines.push(`${indent}  - ${st.summary}`);
    if (s.body.kind === 'stages') lines.push(...outline(s.body.stages, indent + '  '));
    if (s.body.kind === 'parallel') lines.push(...outline(s.body.branches, indent + '  | '));
    if (s.body.kind === 'matrix') {
      const m = s.body.matrix;
      lines.push(`${indent}  axes: ${m.axes.map((a) => `${a.name}=${a.values.join(',')}`).join(' ')}; cells=${m.cells.length}`);
      lines.push(...outline(m.stages, indent + '  * '));
    }
  }
  return lines;
}

describe('fixtures', () => {
  for (const dir of ['handwritten', 'public']) {
    for (const f of readdirSync(join(FIXTURES, dir)).filter((name) => !name.startsWith('.')).sort()) {
      it(`${dir}/${f}`, () => {
        const r = parseJenkinsfile(read(`${dir}/${f}`));
        const summary = {
          kind: r.kind,
          diagnostics: r.diagnostics.map((d) => `${d.severity} L${d.loc.line}: ${d.message}`),
          preamble: r.preamble.map((p) => p.name),
          agent: r.pipeline?.agent?.summary,
          post: r.pipeline?.post?.conditions.map((c) => c.condition),
          stages: r.pipeline ? outline(r.pipeline.stages) : [],
        };
        expect(summary).toMatchSnapshot();
      });
    }
  }
});

describe('specifics', () => {
  it('parses the kitchen sink without errors', () => {
    const r = parseJenkinsfile(read('handwritten/02-kitchen-sink.Jenkinsfile'));
    expect(r.kind).toBe('declarative');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const [build, test, cross, deploy] = r.pipeline!.stages;
    expect(build.body.kind).toBe('steps');
    expect(test.body.kind).toBe('parallel');
    expect(cross.body.kind === 'matrix' && cross.body.matrix.cells).toHaveLength(3);
    expect(deploy.when?.summary).toBe("branch 'main' and expression { params.DEPLOY }");
    expect(deploy.input?.message).toBe('Ship it?');
  });

  it('ignores braces inside strings, comments and regexes', () => {
    const r = parseJenkinsfile(read('handwritten/06-groovy-traps.Jenkinsfile'));
    expect(r.kind).toBe('declarative');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.preamble.map((p) => p.name)).toEqual(['@Library', 'def', 'def']);
    expect(r.pipeline!.agent?.kind).toBe('kubernetes');
    expect(r.pipeline!.stages.map((s) => s.name)).toEqual(['Build ${env.BRANCH_NAME}', 'Shared lib step']);
    expect(r.pipeline!.stages[0].dynamicName).toBe(true);
  });

  it('reports scripted pipelines', () => {
    const r = parseJenkinsfile(read('handwritten/07-scripted.Jenkinsfile'));
    expect(r.kind).toBe('scripted');
  });

  it('recovers from a missing brace and still finds all stages', () => {
    const r = parseJenkinsfile(read('handwritten/08-broken.Jenkinsfile'));
    expect(r.kind).toBe('declarative');
    expect(r.pipeline!.stages.map((s) => s.name)).toEqual(['Build', 'Test', 'Deploy']);
    expect(r.diagnostics.some((d) => d.severity === 'error' && d.loc.line === 7)).toBe(true);
  });

  it('applies matrix excludes including notValues', () => {
    const r = parseJenkinsfile(read('handwritten/09-big-matrix.Jenkinsfile'));
    const m = r.pipeline!.stages[0].body;
    // 3*3*2 = 18, minus mac+mysql (3 JDKs) = 15
    expect(m.kind === 'matrix' && m.matrix.cells.length).toBe(15);
  });

  it('enforces one body per stage and no nested parallel', () => {
    const r = parseJenkinsfile(`pipeline { agent any; stages {
      stage('A') { steps { echo 'a' }; stages { stage('B') { steps { echo 'b' } } } }
      stage('P') { parallel { stage('Q') { parallel { stage('R') { steps { echo 'r' } } } } } }
      stage('A') { steps { echo 'dup' } }
    } }`);
    const msgs = r.diagnostics.map((d) => d.message).join('\n');
    expect(msgs).toMatch(/exactly one of steps, stages, parallel or matrix/);
    expect(msgs).toMatch(/parallel cannot be used inside a stage that is already within a parallel/);
    expect(msgs).toMatch(/Duplicate stage name 'A'/);
  });
});
