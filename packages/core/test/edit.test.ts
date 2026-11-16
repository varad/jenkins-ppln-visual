import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LABEL_GAP, LINE_H, applyEdit, buildGraph, canMove, canRemove, canRename, dropSlots, indexStages, layoutGraph, moveStage, parseJenkinsfile, removeStage, renameError, renameStage, slotDistance, type DropTarget } from '../src/index.js';

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
    const sp = parseJenkinsfile(single).pipeline!;
    expect(canMove(sp, 'Test/E2E/Run', { containerId: 'Test/E2E', index: 0 })).toBe(false); // into the stage it empties
    const only = "pipeline {\n    agent any\n    stages {\n        stage('X') {\n            stages {\n                stage('Y') { steps { echo 'y' } }\n            }\n        }\n    }\n}\n";
    expect(canMove(parseJenkinsfile(only).pipeline!, 'X/Y', { containerId: null, index: 0 })).toBe(false); // would take the last stage
  });

  it('removes the stage that a move leaves empty', () => {
    const single = move(kitchen, 'Test/E2E/Setup', { containerId: null, index: 0 })!.out;
    const r = move(single, 'Test/E2E/Run', { containerId: null, index: 1 })!;
    // E2E goes, and so does the Test parallel it leaves with only Unit.
    expect(names(r.out, null)).toEqual(['Setup', 'Run', 'Build', 'Unit', 'Cross-platform', 'Deploy']);
    expect(r.out).not.toContain("stage('E2E')");
    expect(r.out).not.toContain('node:20'); // its settings go with it
    expect(r.out).toContain("        stage('Build') { steps { sh 'make build' } }\n        stage('Unit') { steps { sh 'make unit' } }\n        stage('Cross-platform') {");
    expect(r.result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.out.slice(r.stageOffset).startsWith("stage('Run')")).toBe(true);
  });

  it('collapses a parallel left with one branch into that branch', () => {
    const r = move(kitchen, 'Test/Unit', { containerId: null, index: 0 })!;
    expect(names(r.out, null)).toEqual(['Unit', 'Build', 'E2E', 'Cross-platform', 'Deploy']);
    expect(names(r.out, 'E2E')).toEqual(['Setup', 'Run']);
    expect(r.out).not.toContain("stage('Test')");
    expect(r.out).toContain("        stage('E2E') {\n            agent { docker { image 'node:20' } }\n            stages {\n                stage('Setup')");
    expect(r.result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.out.slice(r.stageOffset).startsWith("stage('Unit')")).toBe(true);
  });

  it('undoes a fork by dragging the branch back out', () => {
    const src = "pipeline {\n    agent any\n    stages {\n        stage('a') { steps { echo 'a' } }\n        stage('b') { steps { echo 'b' } }\n        stage('c') { steps { echo 'c' } }\n    }\n}\n";
    const forked = move(src, 'b', { fork: 'a' })!.out;
    expect(move(forked, 'a | b/b', { containerId: null, index: 1 })!.out).toBe(src);
  });

  it('keeps a parallel that has settings of its own', () => {
    const ff = read('handwritten/03-parallel-failfast.Jenkinsfile');
    const p = parseJenkinsfile(ff).pipeline!;
    const tests = p.stages.find((x) => x.name === 'Tests')!;
    if (tests.body.kind !== 'parallel') throw new Error('fixture changed');
    let out = ff;
    for (const b of tests.body.branches.slice(1)) out = move(out, b.id, { containerId: null, index: 0 })!.out;
    expect(names(out, 'Tests')).toHaveLength(1); // failFast keeps it
  });

  it('removes every stage that the move leaves empty, up to one with other stages', () => {
    const src = "pipeline {\n    agent any\n    stages {\n        stage('A') { steps { echo 'a' } }\n        stage('X') {\n            stages {\n                stage('Y') {\n                    stages {\n                        stage('Z') { steps { echo 'z' } }\n                    }\n                }\n            }\n        }\n    }\n}\n";
    const r = move(src, 'X/Y/Z', { containerId: null, index: 0 })!;
    expect(r.out).toBe("pipeline {\n    agent any\n    stages {\n        stage('Z') { steps { echo 'z' } }\n        stage('A') { steps { echo 'a' } }\n    }\n}\n");
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

describe('running a stage in parallel', () => {
  const src = `pipeline {
    agent any
    stages {
        stage('a') { steps { echo 'a' } }
        // b runs the slow suite
        stage('b') { steps { echo 'b' } }
        stage('c') { steps { echo 'c' } }
    }
}
`;
  const errors = (r: ReturnType<typeof parseJenkinsfile>) => r.diagnostics.filter((d) => d.severity === 'error');

  it("puts b under a in a new 'a | b' parallel", () => {
    const r = move(src, 'b', { fork: 'a' })!;
    expect(r.out).toBe(`pipeline {
    agent any
    stages {
        stage('a | b') {
            parallel {
                stage('a') { steps { echo 'a' } }
                // b runs the slow suite
                stage('b') { steps { echo 'b' } }
            }
        }
        stage('c') { steps { echo 'c' } }
    }
}
`);
    expect(errors(r.result)).toEqual([]);
    expect(names(r.out, null)).toEqual(['a | b', 'c']);
    expect(names(r.out, 'a | b')).toEqual(['a', 'b']);
    expect(r.out.slice(r.stageOffset).startsWith("stage('b')")).toBe(true);
  });

  it('forks a stage from further along the sequence', () => {
    const r = move(src, 'c', { fork: 'a' })!;
    expect(names(r.out, null)).toEqual(['a | c', 'b']);
    expect(names(r.out, 'a | c')).toEqual(['a', 'c']);
    expect(errors(r.result)).toEqual([]);
  });

  it('forks inside a sequential stage group', () => {
    const kitchen = read('handwritten/02-kitchen-sink.Jenkinsfile');
    const r = move(kitchen, 'Build', { fork: 'Deploy' })!;
    expect(names(r.out, null)).toEqual(['Test', 'Cross-platform', 'Deploy | Build']);
    expect(errors(r.result)).toEqual([]);
  });

  it('keeps stage names unique', () => {
    const taken = src.replace("stage('c')", "stage('a | b')");
    const r = move(taken, 'b', { fork: 'a' })!;
    expect(names(r.out, null)).toEqual(['a | b 2', 'a | b']);
    expect(errors(r.result)).toEqual([]);
  });

  it('takes a drop just under the stage, and leaves the rail to the sequence', async () => {
    const p = parseJenkinsfile(src).pipeline!;
    const layout = await layoutGraph(buildGraph(p));
    const slots = dropSlots(layout, p);
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const rail = a.absY + a.height / 2;
    const below = a.absY + a.height + LABEL_GAP + a.lines.length * LINE_H + 10;
    const nearest = (x: number, y: number, id = 'c') =>
      slots.filter((s) => canMove(p, id, s.target)).sort((s, t) => slotDistance(s, x, y) - slotDistance(t, x, y))[0].target;
    expect(nearest(a.absX + a.width / 2, below)).toEqual({ fork: 'a' });
    expect(nearest(a.absX + a.width + 4, rail)).toEqual({ containerId: null, index: 1 });
  });

  it('rejects forks that Jenkins would refuse', () => {
    const kitchen = parseJenkinsfile(read('handwritten/02-kitchen-sink.Jenkinsfile')).pipeline!;
    const p = parseJenkinsfile(src).pipeline!;
    expect(canMove(p, 'a', { fork: 'a' })).toBe(false); // itself
    expect(canMove(kitchen, 'Build', { fork: 'Test/Unit' })).toBe(false); // a parallel branch: parallel inside parallel
    expect(canMove(kitchen, 'Build', { fork: 'Test/E2E/Setup' })).toBe(false); // nested under a parallel
    expect(canMove(kitchen, 'Build', { fork: 'Test' })).toBe(false); // already forks
    expect(canMove(kitchen, 'Test', { fork: 'Build' })).toBe(false); // the moved stage forks
    expect(canMove(kitchen, 'Cross-platform/Smoke', { fork: 'Build' })).toBe(false); // a matrix cell
    expect(canMove(kitchen, 'Build', { fork: 'Cross-platform/Smoke' })).toBe(false);
  });
});

describe('removeStage', () => {
  const abc = `pipeline {
    agent any
    stages {
        stage('a') { steps { echo 'a' } }
        // b runs the slow suite
        stage('b') { steps { echo 'b' } }
        stage('c') { steps { echo 'c' } }
    }
}
`;
  const kitchen = read('handwritten/02-kitchen-sink.Jenkinsfile');
  const errors = (r: ReturnType<typeof parseJenkinsfile>) => r.diagnostics.filter((d) => d.severity === 'error');
  function remove(src: string, stageId: string) {
    const p = parseJenkinsfile(src).pipeline!;
    const r = removeStage(src, p, stageId);
    if (!r) return null;
    expect(r.stageOffset).toBe(-1);
    const out = applyEdit(src, r.edit);
    return { out, result: parseJenkinsfile(out) };
  }

  it('deletes the stage with the comments above it', () => {
    expect(remove(abc, 'b')!.out).toBe(abc.replace("        // b runs the slow suite\n        stage('b') { steps { echo 'b' } }\n", ''));
  });

  it('removes a stage left empty, and collapses the parallel it leaves with one branch', () => {
    const single = move(kitchen, 'Test/E2E/Setup', { containerId: null, index: 0 })!.out;
    const r = remove(single, 'Test/E2E/Run')!;
    expect(names(r.out, null)).toEqual(['Setup', 'Build', 'Unit', 'Cross-platform', 'Deploy']);
    expect(r.out).not.toContain('node:20');
    expect(errors(r.result)).toEqual([]);
  });

  it('undoes a fork when a branch is removed', () => {
    const forked = move(abc, 'b', { fork: 'a' })!.out;
    expect(remove(forked, 'a | b/b')!.out).toBe(abc.replace("        // b runs the slow suite\n        stage('b') { steps { echo 'b' } }\n", ''));
  });

  it('keeps a parallel that has settings of its own', () => {
    const ff = read('handwritten/03-parallel-failfast.Jenkinsfile');
    const tests = parseJenkinsfile(ff).pipeline!.stages.find((x) => x.name === 'Tests')!;
    if (tests.body.kind !== 'parallel') throw new Error('fixture changed');
    let out = ff;
    for (const b of tests.body.branches.slice(1)) out = remove(out, b.id)!.out;
    expect(names(out, 'Tests')).toHaveLength(1);
  });

  it("refuses the pipeline's last stage, matrix cells and unknown stages", () => {
    const one = "pipeline {\n    agent any\n    stages {\n        stage('X') {\n            stages {\n                stage('Y') { steps { echo 'y' } }\n            }\n        }\n    }\n}\n";
    const p1 = parseJenkinsfile(one).pipeline!;
    expect(canRemove(p1, 'X')).toBe(false);
    expect(canRemove(p1, 'X/Y')).toBe(false);
    const p = parseJenkinsfile(kitchen).pipeline!;
    expect(canRemove(p, 'Cross-platform/Smoke')).toBe(false);
    expect(canRemove(p, 'nope')).toBe(false);
    expect(removeStage(kitchen, p, 'nope')).toBeNull();
    expect(canRemove(p, 'Cross-platform')).toBe(true);
  });

  for (const dir of ['handwritten', 'public']) {
    const files = readdirSync(join(FIXTURES, dir), { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.'));
    for (const f of files.map((e) => e.name).sort()) {
      it(`leaves a valid pipeline: ${dir}/${f}`, () => {
        const src = read(`${dir}/${f}`);
        const r = parseJenkinsfile(src);
        if (!r.pipeline) return;
        for (const id of indexStages(r.pipeline.stages).keys()) {
          const m = canRemove(r.pipeline, id) ? removeStage(src, r.pipeline, id) : null;
          if (!m) continue;
          const after = parseJenkinsfile(applyEdit(src, m.edit));
          expect(errors(after).length, id).toBeLessThanOrEqual(errors(r).length);
          expect(indexStages(after.pipeline!.stages).has(id), id).toBe(false);
        }
      });
    }
  }
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
            // A wrap adds a stage; an unwrap, or a stage left empty, removes some.
            expect(indexStages(after.pipeline!.stages).size - stages.size).toBeLessThanOrEqual(1);
            const name = stages.get(id)!.name;
            expect(out.slice(m.stageOffset)).toMatch(new RegExp(`^stage\\s*\\(\\s*['"]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
          }
        }
      });
    }
  }
});

describe('renameStage', () => {
  const basic = read('handwritten/01-basic.Jenkinsfile');
  const kitchen = read('handwritten/02-kitchen-sink.Jenkinsfile');

  function rename(src: string, stageId: string, name: string) {
    const p = parseJenkinsfile(src).pipeline!;
    const r = renameStage(src, p, stageId, name);
    if (!r) return null;
    const out = applyEdit(src, r.edit);
    return { out, result: parseJenkinsfile(out), stageOffset: r.stageOffset };
  }

  it('rewrites only the name literal', () => {
    const r = rename(basic, 'Build', 'Compile')!;
    expect(r.out).toBe(basic.replace("stage('Build')", "stage('Compile')"));
    expect(names(r.out, null)).toEqual(['Checkout', 'Compile', 'Test', 'Package']);
    expect(r.out.slice(r.stageOffset).startsWith("stage('Compile')")).toBe(true);
  });

  it('renames nested, parallel and matrix stages', () => {
    expect(names(rename(kitchen, 'Test/Unit', 'Unit tests')!.out, 'Test')).toEqual(['Unit tests', 'E2E']);
    expect(names(rename(kitchen, 'Test/E2E/Setup', 'Install')!.out, 'Test/E2E')).toEqual(['Install', 'Run']);
    const m = rename(kitchen, 'Cross-platform/Smoke', 'Sanity')!;
    expect(m.out).toContain("stage('Sanity')");
    expect(m.result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('keeps double quotes and escapes what the literal needs', () => {
    const src = basic.replace("stage('Build')", 'stage("Build")');
    expect(rename(src, 'Build', 'Build "$all"')!.out).toContain('stage("Build \\"\\$all\\"")');
    const r = rename(basic, 'Build', "It's \\ here")!;
    expect(r.out).toContain("stage('It\\'s \\\\ here')");
    const p = r.result.pipeline!;
    expect(p.stages[1].dynamicName).toBe(false);
    expect(renameError(p, p.stages[1].id, "It's \\ here")).toBe('The name is unchanged.');
  });

  it('trims the new name', () => {
    expect(names(rename(basic, 'Build', '  Compile ')!.out, null)[1]).toBe('Compile');
  });

  it('refuses names that are empty, unchanged, taken or multi-line', () => {
    const p = parseJenkinsfile(basic).pipeline!;
    for (const n of ['', '   ', 'Build', 'Test', 'a\nb']) {
      expect(renameError(p, 'Build', n)).not.toBeNull();
      expect(renameStage(basic, p, 'Build', n)).toBeNull();
    }
  });

  it('refuses dynamic names', () => {
    const src = basic.replace("stage('Build')", 'stage("Build ${env.X}")');
    const p = parseJenkinsfile(src).pipeline!;
    const id = p.stages[1].id;
    expect(canRename(p, id)).toBe(false);
    expect(renameStage(src, p, id, 'Compile')).toBeNull();
  });
});
