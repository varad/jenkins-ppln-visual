import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJenkinsfile, buildGraph, layoutGraph, toMermaid, toSvg } from '../src/index.js';

const FIXTURES = join(__dirname, '../../../fixtures');
const OUT = process.env.JPV_OUT;

describe('graph + layout + exports', () => {
  for (const dir of ['handwritten', 'public']) {
    for (const f of readdirSync(join(FIXTURES, dir)).filter((name) => !name.startsWith('.')).sort()) {
      it(`${dir}/${f}`, async () => {
        const r = parseJenkinsfile(readFileSync(join(FIXTURES, dir, f), 'utf8'));
        if (!r.pipeline) return;
        const g = buildGraph(r.pipeline);
        const ids = new Set(g.nodes.map((n) => n.id));
        expect(ids.size).toBe(g.nodes.length);
        for (const e of g.edges) {
          expect(ids.has(e.source)).toBe(true);
          expect(ids.has(e.target)).toBe(true);
        }
        const layout = await layoutGraph(g);
        expect(layout.width).toBeGreaterThan(0);
        for (const n of layout.nodes) expect(Number.isFinite(n.absX) && Number.isFinite(n.absY)).toBe(true);
        expect(await layoutGraph(g, { maxWidth: 1e6 })).toEqual(layout);

        const wrapped = await layoutGraph(g, { maxWidth: 600 });
        for (const n of wrapped.nodes) expect(Number.isFinite(n.absX) && Number.isFinite(n.absY)).toBe(true);
        expect(toSvg(wrapped).match(/data-stage-id="/g)?.length ?? 0).toBe(layout.nodes.filter((n) => n.stageId).length);
        for (const e of wrapped.edges.filter((e) => e.parentId === undefined)) {
          const crossesRows = e.points[0].y !== e.points[e.points.length - 1].y;
          expect(e.points.length).toBe(crossesRows ? 6 : 2);
        }
        // Only a single top-level box that is itself too wide may overflow the limit.
        if (wrapped.width > 600) {
          expect(wrapped.nodes.some((n) => n.parentId === undefined && n.width > 600 - 48)).toBe(true);
        }

        const mm = toMermaid(r.pipeline);
        expect(mm.startsWith('flowchart LR')).toBe(true);
        expect(mm).toMatchSnapshot();
        const stageNodes = layout.nodes.filter((n) => n.stageId).length;
        expect(toSvg(layout).match(/data-stage-id="/g)?.length ?? 0).toBe(stageNodes);
        if (OUT) {
          mkdirSync(OUT, { recursive: true });
          writeFileSync(join(OUT, `${f}.svg`), toSvg(layout));
          writeFileSync(join(OUT, `${f}.mmd`), mm);
        }
      });
    }
  }
});
