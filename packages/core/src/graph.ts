// Turns the pipeline model into a nested graph, and lays it out as rails:
// stages sit on horizontal lines, parallel branches stack below the first one.

import { MATRIX_EXPAND_LIMIT } from './declarative.js';
import type { Pipeline, Stage } from './model.js';

export type GNodeKind = 'start' | 'end' | 'stage' | 'group' | 'fork' | 'join' | 'post';
export type GroupKind = 'stages' | 'parallel' | 'matrix' | 'cell';

export interface Badge {
  kind: 'agent' | 'when' | 'input' | 'post' | 'retry' | 'timeout' | 'dynamic' | 'failFast' | 'steps' | 'matrix';
  label: string;
  title?: string;
}

export interface GNode {
  id: string;
  parentId?: string;
  kind: GNodeKind;
  groupKind?: GroupKind;
  label: string;
  subtitle?: string;
  /** Model stage id, for selection and source navigation. */
  stageId?: string;
  conditional?: boolean;
  badges: Badge[];
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  /** Container both ends live in (undefined = root). */
  parentId?: string;
  kind: 'flow' | 'post';
}

export interface PipelineGraph {
  nodes: GNode[];
  edges: GEdge[];
}

export interface LaidOutNode extends GNode {
  /** Absolute position on the canvas: the circle for leaves, the title area for groups. */
  absX: number;
  absY: number;
  width: number;
  height: number;
  /** Label and subtitle, wrapped and truncated to fit. */
  lines: string[];
  sublines: string[];
  /** Group whose label sits on its rail, at the start of a parallel branch. */
  rowLabel?: boolean;
}

export interface LaidOutEdge extends GEdge {
  /** Absolute polyline points. */
  points: { x: number; y: number }[];
}

export interface PipelineLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export function stageBadges(s: Stage): Badge[] {
  const b: Badge[] = [];
  if (s.when) b.push({ kind: 'when', label: 'when', title: s.when.summary });
  if (s.input) b.push({ kind: 'input', label: 'input', title: s.input.message });
  if (s.agent) b.push({ kind: 'agent', label: s.agent.summary, title: `agent ${s.agent.summary}` });
  const retry = s.options?.find((o) => o.name === 'retry');
  if (retry) b.push({ kind: 'retry', label: 'retry', title: retry.raw });
  const timeout = s.options?.find((o) => o.name === 'timeout');
  if (timeout) b.push({ kind: 'timeout', label: 'timeout', title: timeout.raw });
  if (s.failFast) b.push({ kind: 'failFast', label: 'failFast', title: 'Stop other branches when one fails' });
  if (s.post) b.push({ kind: 'post', label: 'post', title: s.post.conditions.map((c) => c.condition).join(', ') });
  if (s.body.kind === 'steps') {
    const n = s.body.steps.length;
    if (s.body.steps.some((st) => st.dynamic)) b.push({ kind: 'dynamic', label: 'script', title: 'Contains script { } blocks: imperative Groovy, shown but not evaluated' });
    b.unshift({ kind: 'steps', label: `${n} step${n === 1 ? '' : 's'}` });
  }
  return b;
}

export function buildGraph(p: Pipeline): PipelineGraph {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  let edgeSeq = 0;
  const edge = (source: string, target: string, parentId?: string, kind: GEdge['kind'] = 'flow') =>
    edges.push({ id: `e${edgeSeq++}`, source, target, parentId, kind });

  const addNode = (n: Omit<GNode, 'badges'> & Partial<Pick<GNode, 'badges'>>) => {
    nodes.push({ ...n, badges: n.badges ?? [] });
    return n.id;
  };

  const sequence = (stages: Stage[], parentId: string | undefined, prefix: string): { first?: string; last?: string } => {
    let first: string | undefined;
    let prev: string | undefined;
    for (const s of stages) {
      const id = addStage(s, parentId, prefix);
      if (prev) edge(prev, id, parentId);
      else first = id;
      prev = id;
    }
    return { first, last: prev };
  };

  const fanOut = (groupId: string, items: string[]) => {
    const fork = addNode({ id: `${groupId}::fork`, parentId: groupId, kind: 'fork', label: '' });
    const join = addNode({ id: `${groupId}::join`, parentId: groupId, kind: 'join', label: '' });
    for (const it of items) {
      edge(fork, it, groupId);
      edge(it, join, groupId);
    }
  };

  function addStage(s: Stage, parentId: string | undefined, prefix: string): string {
    const id = prefix + s.id;
    const conditional = !!s.when;
    const badges = stageBadges(s);
    switch (s.body.kind) {
      case 'steps':
      case 'empty':
        return addNode({ id, parentId, kind: 'stage', label: s.name, stageId: s.id, conditional, badges });
      case 'stages': {
        addNode({ id, parentId, kind: 'group', groupKind: 'stages', label: s.name, subtitle: 'stages', stageId: s.id, conditional, badges });
        sequence(s.body.stages, id, prefix);
        return id;
      }
      case 'parallel': {
        addNode({ id, parentId, kind: 'group', groupKind: 'parallel', label: s.name, subtitle: 'parallel', stageId: s.id, conditional, badges });
        const branchIds = s.body.branches.map((b) => addStage(b, id, prefix));
        fanOut(id, branchIds);
        return id;
      }
      case 'matrix': {
        const m = s.body.matrix;
        const mBadges: Badge[] = [...badges];
        if (m.when) mBadges.push({ kind: 'when', label: 'when', title: m.when.summary });
        if (m.agent) mBadges.push({ kind: 'agent', label: m.agent.summary, title: `agent ${m.agent.summary}` });
        if (m.post) mBadges.push({ kind: 'post', label: 'post', title: m.post.conditions.map((c) => c.condition).join(', ') });
        const dims = m.axes.map((a) => a.values.length).join('×');
        addNode({
          id,
          parentId,
          kind: 'group',
          groupKind: 'matrix',
          label: s.name,
          subtitle: `matrix ${dims} → ${m.cells.length} cell${m.cells.length === 1 ? '' : 's'}`,
          stageId: s.id,
          conditional: conditional || !!m.when,
          badges: mBadges,
        });
        const expand = m.cells.length <= MATRIX_EXPAND_LIMIT;
        const cells = expand ? m.cells : [Object.fromEntries(m.axes.map((a) => [a.name, `${a.name}`]))];
        const cellIds = cells.map((cell, ci) => {
          const cellLabel = expand ? Object.values(cell).join(' · ') : `each of ${m.cells.length} cells`;
          const cellId = `${id}::cell${ci}`;
          if (m.stages.length === 1) {
            const st = m.stages[0];
            return addNode({ id: cellId, parentId: id, kind: 'stage', label: st.name, subtitle: cellLabel, stageId: st.id, conditional: !!st.when, badges: stageBadges(st) });
          }
          addNode({ id: cellId, parentId: id, kind: 'group', groupKind: 'cell', label: cellLabel, badges: [] });
          sequence(m.stages, cellId, `${cellId}::`);
          return cellId;
        });
        fanOut(id, cellIds);
        return id;
      }
    }
  }

  const start = addNode({ id: '::start', kind: 'start', label: 'Start' });
  const { first, last } = sequence(p.stages, undefined, '');
  let tail = last ?? start;
  if (first) edge(start, first);
  if (p.post && p.post.conditions.length) {
    const post = addNode({
      id: '::post',
      kind: 'post',
      label: 'post',
      subtitle: p.post.conditions.map((c) => c.condition).join(' · '),
      badges: [],
    });
    edge(tail, post, undefined, 'post');
    tail = post;
  }
  const end = addNode({ id: '::end', kind: 'end', label: 'End' });
  edge(tail, end);
  return { nodes, edges };
}

export const STAGE_R = 12;
export const DOT_R = 6;
export const LINE_H = 15;
export const LABEL_GAP = 6;
const CHAR_W = 6.4;
const TITLE_CHAR_W = 7.4;
const ROW_CHAR_W = 7.4;
const MAX_LINE = 18;
const STAGE_GAP = 40;
const ROW_GAP = 14;
const TRUNK = 26;
const ROW_LEAD = 8;
const PAD = 24;

const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);

/** Wraps to at most two lines, truncating whatever doesn't fit. */
function wrapLabel(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (lines.length === 1) {
      line = line ? `${line} ${word}` : word;
    } else if (!line || line.length + 1 + word.length <= MAX_LINE) {
      line = line ? `${line} ${word}` : word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map(clip);
}

/** A laid-out piece of the drawing, measured around the rail it sits on. */
interface Box {
  width: number;
  up: number;
  down: number;
  place: (x: number, rail: number) => void;
}

type Geometry = Pick<LaidOutNode, 'absX' | 'absY' | 'width' | 'height' | 'lines' | 'sublines' | 'rowLabel'>;

export async function layoutGraph(g: PipelineGraph): Promise<PipelineLayout> {
  const children = new Map<string | undefined, GNode[]>();
  for (const n of g.nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));

  const placed = new Map<string, Geometry>();
  /** Where lines enter and leave each node. */
  const ports = new Map<string, { inX: number; outX: number; y: number }>();
  const leads: LaidOutEdge[] = [];

  const isForked = (id: string | undefined) => !!children.get(id)?.some((c) => c.kind === 'fork');

  const leaf = (n: GNode): Box => {
    const dot = n.kind === 'start' || n.kind === 'end';
    const r = dot ? DOT_R : STAGE_R;
    const lines = dot ? [n.label] : wrapLabel(n.label);
    const sublines = n.subtitle ? wrapLabel(n.subtitle) : [];
    const textH = LABEL_GAP + (lines.length + sublines.length) * LINE_H;
    const width = Math.max(2 * r, ...[...lines, ...sublines].map((l) => l.length * CHAR_W));
    return {
      width,
      up: dot ? r + textH : r,
      down: dot ? r : r + textH,
      place: (x, rail) => {
        const cx = x + width / 2;
        placed.set(n.id, { absX: cx - r, absY: rail - r, width: 2 * r, height: 2 * r, lines, sublines });
        ports.set(n.id, { inX: cx - r, outX: cx + r, y: rail });
      },
    };
  };

  const row = (items: GNode[]): Box => {
    const boxes = items.map(box);
    return {
      width: boxes.reduce((w, b) => w + b.width, 0) + STAGE_GAP * Math.max(0, boxes.length - 1),
      up: Math.max(STAGE_R, ...boxes.map((b) => b.up)),
      down: Math.max(STAGE_R, ...boxes.map((b) => b.down)),
      place: (x, rail) => {
        let cx = x;
        for (const b of boxes) {
          b.place(cx, rail);
          cx += b.width + STAGE_GAP;
        }
      },
    };
  };

  const stack = (group: GNode, items: GNode[]): Box => {
    const boxes = items.map(box);
    const width = Math.max(0, ...boxes.map((b) => b.width)) + 2 * TRUNK;
    const down = boxes.reduce((d, b, i) => (i ? d + ROW_GAP + b.up + b.down : b.down), STAGE_R);
    return {
      width,
      up: boxes[0]?.up ?? STAGE_R,
      down,
      place: (x, rail) => {
        let y = rail;
        boxes.forEach((b, i) => {
          if (i) y += boxes[i - 1].down + ROW_GAP + b.up;
          b.place(x + TRUNK, y);
        });
        const forkX = x + TRUNK / 2;
        const joinX = x + width - TRUNK / 2;
        for (const [id, at] of [[`${group.id}::fork`, forkX], [`${group.id}::join`, joinX]] as const) {
          placed.set(id, { absX: at, absY: rail, width: 0, height: 0, lines: [], sublines: [] });
          ports.set(id, { inX: at, outX: at, y: rail });
        }
        ports.set(group.id, { inX: forkX, outX: joinX, y: rail });
      },
    };
  };

  const group = (n: GNode): Box => {
    const forked = isForked(n.id);
    const items = (children.get(n.id) ?? []).filter((c) => c.kind !== 'fork' && c.kind !== 'join');
    const body = forked ? stack(n, items) : row(items);

    const portsFromChildren = (x: number, rail: number) => {
      const first = items.length ? ports.get(items[0].id)! : undefined;
      const last = items.length ? ports.get(items[items.length - 1].id)! : undefined;
      ports.set(n.id, { inX: first?.inX ?? x, outX: last?.outX ?? x, y: rail });
    };

    if (!forked && isForked(n.parentId)) {
      const label = clip(n.label);
      const labelW = label.length * ROW_CHAR_W;
      return {
        width: labelW + ROW_LEAD + body.width,
        up: Math.max(LINE_H / 2, body.up),
        down: Math.max(LINE_H / 2, body.down),
        place: (x, rail) => {
          const bodyX = x + labelW + ROW_LEAD;
          body.place(bodyX, rail);
          placed.set(n.id, { absX: x, absY: rail - LINE_H / 2, width: labelW, height: LINE_H, lines: [label], sublines: [], rowLabel: true });
          portsFromChildren(bodyX, rail);
          const port = ports.get(n.id)!;
          if (items.length) {
            leads.push({ id: `${n.id}::lead`, source: n.id, target: items[0].id, parentId: n.id, kind: 'flow', points: [{ x: x + labelW + 4, y: rail }, { x: port.inX, y: rail }] });
          }
          ports.set(n.id, { ...port, inX: x - 4 });
        },
      };
    }

    const lines = wrapLabel(n.label);
    const titleH = lines.length * LINE_H + LABEL_GAP;
    const width = Math.max(body.width, ...lines.map((l) => l.length * TITLE_CHAR_W));
    const up = body.up + titleH;
    return {
      width,
      up,
      down: body.down,
      place: (x, rail) => {
        const bodyX = x + (width - body.width) / 2;
        body.place(bodyX, rail);
        placed.set(n.id, { absX: x, absY: rail - up, width, height: titleH, lines, sublines: [] });
        if (!forked) portsFromChildren(bodyX, rail);
      },
    };
  };

  function box(n: GNode): Box {
    return n.kind === 'group' ? group(n) : leaf(n);
  }

  const root = row(children.get(undefined) ?? []);
  root.place(PAD, PAD + root.up);

  const edges: LaidOutEdge[] = g.edges.map((e) => {
    const a = ports.get(e.source)!;
    const b = ports.get(e.target)!;
    const from = { x: a.outX, y: a.y };
    const to = { x: b.inX, y: b.y };
    if (a.y === b.y) return { ...e, points: [from, to] };
    const corner = byId.get(e.target)?.kind === 'join' ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    return { ...e, points: [from, corner, to] };
  });

  return {
    nodes: g.nodes.map((n) => ({ ...n, ...placed.get(n.id)! })),
    edges: [...edges, ...leads],
    width: Math.ceil(root.width + 2 * PAD),
    height: Math.ceil(root.up + root.down + 2 * PAD),
  };
}
