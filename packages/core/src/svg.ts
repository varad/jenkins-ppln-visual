// Standalone SVG rendering of a laid-out pipeline, used for the preview and "Download SVG".
// The background is transparent, so text switches color with the viewer's color scheme.

import { LABEL_GAP, LINE_H, type LaidOutNode, type PipelineLayout } from './graph.js';

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const C = {
  ink: '#1f2328',
  quiet: '#656d76',
  rail: '#949494',
  stage: '#8cc04f',
  post: '#e3b341',
  when: '#bf8700',
};

const RAIL_W = 3;
const CORNER = 10;

const DARK_MODE = `<style>@media (prefers-color-scheme: dark){.jpv-ink{fill:#e6edf3}.jpv-quiet{fill:#8d96a0}}</style>`;

function roundedPath(pts: { x: number; y: number }[]): string {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const d1 = Math.hypot(c.x - p.x, c.y - p.y), d2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(CORNER, d1 / 2, d2 / 2);
    d += ` L${c.x - ((c.x - p.x) / d1) * r},${c.y - ((c.y - p.y) / d1) * r} Q${c.x},${c.y} ${c.x + ((n.x - c.x) / d2) * r},${c.y + ((n.y - c.y) / d2) * r}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x},${last.y}`;
}

function text(px: number, py: number, content: string, attrs: string, tone: 'ink' | 'quiet' | 'when' = 'ink'): string {
  const paint = tone === 'when' ? `fill="${C.when}"` : `class="jpv-${tone}" fill="${C[tone]}"`;
  return `<text x="${px}" y="${py}" ${attrs} ${paint}>${x(content)}</text>`;
}

function shape(n: LaidOutNode): string {
  const { absX: X, absY: Y, width: W, height: H } = n;
  const cx = X + W / 2;
  const cy = Y + H / 2;
  const middle = 'text-anchor="middle" font-size="12"';
  switch (n.kind) {
    case 'fork':
    case 'join':
      return '';
    case 'start':
    case 'end':
      return `<circle cx="${cx}" cy="${cy}" r="${W / 2}" fill="${C.rail}"/>` + text(cx, Y - LABEL_GAP - 3, n.label, middle);
    case 'group': {
      const tone = n.conditional ? 'when' : 'ink';
      if (n.rowLabel) return text(X, cy + 4, n.lines[0], 'font-size="13"', tone);
      return n.lines.map((l, i) => text(cx, Y + (i + 1) * LINE_H - 4, l, 'text-anchor="middle" font-size="13" font-weight="600"', tone)).join('');
    }
    default: {
      const r = W / 2;
      const circle = n.conditional
        ? `<circle cx="${cx}" cy="${cy}" r="${r - RAIL_W / 2}" fill="transparent" stroke="${C.rail}" stroke-width="${RAIL_W}"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${n.kind === 'post' ? C.post : C.stage}"/>`;
      const top = Y + H + LABEL_GAP - 3;
      return (
        circle +
        n.lines.map((l, i) => text(cx, top + (i + 1) * LINE_H, l, middle)).join('') +
        n.sublines.map((l, i) => text(cx, top + (n.lines.length + i + 1) * LINE_H, l, 'text-anchor="middle" font-size="11"', 'quiet')).join('')
      );
    }
  }
}

/** Stage nodes carry their id, and the pipeline's post node a marker, so previews can map clicks back to the source. */
function node(n: LaidOutNode): string {
  const s = shape(n);
  const marker = n.stageId ? `data-stage-id="${x(n.stageId)}"` : n.kind === 'post' ? 'data-post="true"' : '';
  if (!marker) return s;
  const tip = n.subtitle ? `${n.label} (${n.subtitle})` : n.label;
  return `<g ${marker}><title>${x(tip)}</title>${s}</g>`;
}

export function toSvg(layout: PipelineLayout): string {
  const edges = layout.edges
    .filter((e) => e.points.length > 1)
    .map((e) => `<path d="${roundedPath(e.points)}"${e.kind === 'post' ? ' stroke-dasharray="7 7"' : ''}/>`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="Lato, Inter, system-ui, sans-serif">
${DARK_MODE}
<g fill="none" stroke="${C.rail}" stroke-width="${RAIL_W}" stroke-linecap="round">
${edges}
</g>
${layout.nodes.map(node).filter(Boolean).join('\n')}
</svg>
`;
}
