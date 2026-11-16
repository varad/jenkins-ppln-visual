import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyEdit, buildGraph, canMove, dropSlots, indexStages, layoutGraph, moveStage, parseJenkinsfile, slotDistance, type DropTarget } from '../src/index.js';

const FIXTURES = join(__dirname, '../../../fixtures');
const read = (f: string) => readFileSync(join(FIXTURES, f), 'utf8');

function move(src: string, stageId: string, t: DropTarget) {
  const p = parseJenkinsfile(src).pipeline!;
  const m = moveStage(src, p, stageId, t);
  if (!m) return null;
  const out = applyEdit(src, m.edit);
  return { out, result: parseJenkinsfile(out), stageOffset: m.stageOffset };
}

const names = (src: string, containerId: string | null) => {
  const p = parseJenkinsfile(src).pipeline!;
  if (containerId === null) return p.stages.map((s) => s.name);
  const b = indexStages(p.stages).get(containerId)!.body;
  return b.kind === 'stages' ? b.stages.map((s) => s.name) : b.kind === 'parallel' ? b.branches.map((s) => s.name) : [];
};

describe('moveStage', () => {
  const basic = read('handwritten/01-basic.Jenkinsfile');
  const kitchen = read('handwritten/02-kitchen-sink.Jenkinsfile');

  it('reorders a sequence, forwards and backwards', () => {
    expect(names(move(basic, 'Checkout', { containerId: null, index: 3 })!.out, null)).toEqual(['Build', 'Test', 'Checkout', 'Package']);
    expect(names(move(basic, 'Package', { containerId: null, index: 0 })!.out, null)).toEqual(['Package', 'Checkout', 'Build', 'Test']);
    expect(names(move(basic, 'Build', { containerId: null, index: 4 })!.out, null)).toEqual(['Checkout', 'Test', 'Package', 'Build']);
  });

  it('keeps the text otherwise intact', () => {
    const r = move(basic, 'Checkout', { containerId: null, index: 4 })!;
    expect(r.out).toContain("        stage('Package') { steps { archiveArtifacts artifacts: 'dist/**', fingerprint: true } }\n        stage('Checkout') { steps { checkout scm } }\n    }\n}");
    expect(r.out.length).toBe(basic.length);
  });

  it('moves into a parallel as a new branch, re-indented', () => {
    const r = move(kitchen, 'Build', { containerId: 'Test', index: 1 })!;
    expect(names(r.out, 'Test')).toEqual(['Unit', 'Build', 'E2E']);
    expect(r.out).toContain("                stage('Build') { steps { sh 'make build' } }\n");
    expect(r.result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.out.slice(r.stageOffset).startsWith("stage('Build')")).toBe(true);
  });

  it('moves out of nested stages to the top level', () => {
    const r = move(kitchen, 'Test/E2E/Setup', { containerId: null, index: 0 })!;
    expect(names(r.out, null)[0]).toBe('Setup');
    expect(names(r.out, 'Test/E2E')).toEqual(['Run']);
    expect(r.out.slice(r.stageOffset).startsWith("stage('Setup')")).toBe(true);
  });

  it('rejects invalid moves', () => {
    const p = parseJenkinsfile(kitchen).pipeline!;
    expect(canMove(p, 'Test', { containerId: 'Test', index: 0 })).toBe(false); // into itself
    expect(canMove(p, 'Test', { containerId: 'Test/E2E', index: 0 })).toBe(false); // into a descendant
    expect(canMove(p, 'Cross-platform', { containerId: 'Test', index: 0 })).toBe(false); // matrix into parallel
    expect(canMove(p, 'Test', { containerId: null, index: 1 })).toBe(false); // no-op
    expect(canMove(p, 'Cross-platform/Smoke', { containerId: null, index: 0 })).toBe(false); // matrix stage
    const single = move(kitchen, 'Test/E2E/Setup', { containerId: null, index: 0 })!.out;
    expect(canMove(parseJenkinsfile(single).pipeline!, 'Test/E2E/Run', { containerId: null, index: 0 })).toBe(false); // would empty a list
  });
});

describe('wrapping a parallel branch', () => {
  const src = `pipeline {
    agent any
    stages {
        stage('Prep') { steps { echo 'prep' } }
        stage('P') {
            parallel {
                stage('a') { steps { echo 'a' } }
                // b runs the slow suite
                stage('b') { steps { echo 'b' } }
                stage('c') { steps { echo 'c' } }
            }
        }
    }
}
`;
  const errors = (r: ReturnType<typeof parseJenkinsfile>) => r.diagnostics.filter((d) => d.severity === 'error');

  it("puts b after a in a new 'a → b' branch", () => {
    const r = move(src, 'P/b', { wrap: 'P/a', after: true })!;
    expect(r.out).toBe(`pipeline {
    agent any
    stages {
        stage('Prep') { steps { echo 'prep' } }
        stage('P') {
            parallel {
                stage('a → b') {
                    stages {
                        stage('a') { steps { echo 'a' } }
                        // b runs the slow suite
                        stage('b') { steps { echo 'b' } }
                    }
                }
                stage('c') { steps { echo 'c' } }
            }
        }
    }
}
`);
    expect(errors(r.result)).toEqual([]);
    expect(names(r.out, 'P')).toEqual(['a → b', 'c']);
    expect(names(r.out, 'P/a → b')).toEqual(['a', 'b']);
    expect(r.out.slice(r.stageOffset).startsWith("stage('b')")).toBe(true);
  });

  it('puts the dropped stage first when dropped before the branch', () => {
    const r = move(src, 'P/c', { wrap: 'P/a', after: false })!;
    expect(names(r.out, 'P')).toEqual(['c → a', 'b']);
    expect(names(r.out, 'P/c → a')).toEqual(['c', 'a']);
  });

  it('wraps a top-level stage into a branch', () => {
    const r = move(src, 'Prep', { wrap: 'P/c', after: false })!;
    expect(names(r.out, null)).toEqual(['P']);
    expect(names(r.out, 'P/Prep → c')).toEqual(['Prep', 'c']);
    expect(errors(r.result)).toEqual([]);
  });

  it('keeps stage names unique', () => {
    const taken = src.replace("stage('Prep')", "stage('a → b')");
    const r = move(taken, 'P/b', { wrap: 'P/a', after: true })!;
    expect(names(r.out, 'P')).toEqual(['a → b 2', 'c']);
    expect(errors(r.result)).toEqual([]);
  });

  it('unwraps a bare wrapper left with one stage', () => {
    const wrapped = move(src, 'P/b', { wrap: 'P/a', after: true })!.out;
    const r = move(wrapped, 'P/a → b/b', { containerId: 'P', index: 2 })!;
    expect(names(r.out, 'P')).toEqual(['a', 'c', 'b']);
    expect(r.out).toContain("            parallel {\n                stage('a') { steps { echo 'a' } }\n                stage('c')");
    expect(errors(r.result)).toEqual([]);
    expect(r.out.slice(r.stageOffset).startsWith("stage('b')")).toBe(true);
  });

  it('keeps a wrapper that has settings of its own', () => {
    const kitchen = read('handwritten/02-kitchen-sink.Jenkinsfile');
    const r = move(kitchen, 'Test/E2E/Setup', { containerId: null, index: 0 })!;
    expect(names(r.out, 'Test')).toEqual(['Unit', 'E2E']);
    expect(names(r.out, 'Test/E2E')).toEqual(['Run']);
  });

  it('accepts a drop anywhere along the branch row, not just next to it', async () => {
    const long = src.replace("stage('c')", "stage('a very long branch name')");
    const p = parseJenkinsfile(long).pipeline!;
    const layout = await layoutGraph(buildGraph(p));
    const slots = dropSlots(layout, p);
    const node = (id: string) => layout.nodes.find((n) => n.id === id)!;
    const a = node('P/a');
    const rail = a.absY + a.height / 2;
    const nearest = (x: number, y: number, id = 'P/b') =>
      slots.filter((s) => canMove(p, id, s.target)).sort((s, t) => slotDistance(s, x, y) - slotDistance(t, x, y))[0].target;
    // Close to a, and far along its row next to where the branches join.
    expect(nearest(a.absX + a.width + 15, rail)).toEqual({ wrap: 'P/a', after: true });
    expect(nearest(node('P::join').absX - 4, rail + 6)).toEqual({ wrap: 'P/a', after: true });
    // Between the rows is still a new branch.
    expect(nearest(a.absX + a.width / 2, rail + 30, 'P/a very long branch name')).toEqual({ containerId: 'P', index: 1 });
  });

  it('rejects wraps that Jenkins would refuse', () => {
    const p = parseJenkinsfile(src).pipeline!;
    expect(canMove(p, 'P', { wrap: 'P/a', after: true })).toBe(false); // its own parallel parent
    expect(canMove(p, 'P/a', { wrap: 'P/a', after: true })).toBe(false); // itself
    expect(canMove(p, 'Prep', { wrap: 'Prep', after: true })).toBe(false); // not a parallel branch
    const nested = src.replace("stage('Prep') { steps { echo 'prep' } }", "stage('Prep') { parallel { stage('x') { steps { echo 'x' } } } }");
    expect(canMove(parseJenkinsfile(nested).pipeline!, 'Prep', { wrap: 'P/a', after: true })).toBe(false); // parallel inside parallel
  });
});

describe('every valid drop slot gives a valid pipeline', () => {
  for (const dir of ['handwritten', 'public']) {
    const files = readdirSync(join(FIXTURES, dir), { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.'));
    for (const f of files.map((e) => e.name).sort()) {
      it(`${dir}/${f}`, async () => {
        const src = read(`${dir}/${f}`);
        const r = parseJenkinsfile(src);
        if (!r.pipeline) return;
        const errors = (x: typeof r) => x.diagnostics.filter((d) => d.severity === 'error').length;
        const stages = indexStages(r.pipeline.stages);
        const slots = dropSlots(await layoutGraph(buildGraph(r.pipeline)), r.pipeline);
        for (const id of stages.keys()) {
          for (const { target } of slots) {
            if (!canMove(r.pipeline, id, target)) continue;
            const m = moveStage(src, r.pipeline, id, target);
            if (!m) continue; // stage shares a line with other code
            const out = applyEdit(src, m.edit);
            const after = parseJenkinsfile(out);
            expect(errors(after), `${id} → ${JSON.stringify(target)}`).toBeLessThanOrEqual(errors(r));
            // A wrap adds a stage and an unwrap removes one.
            expect(Math.abs(indexStages(after.pipeline!.stages).size - stages.size)).toBeLessThanOrEqual(1);
            const name = stages.get(id)!.name;
            expect(out.slice(m.stageOffset)).toMatch(new RegExp(`^stage\\s*\\(\\s*['"]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
          }
        }
      });
    }
  }
});
