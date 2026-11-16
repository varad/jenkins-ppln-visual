// Moving a stage by rewriting the Jenkinsfile: the diagram is always derived from the
// source, so a drag in the picture becomes a cut-and-paste of the stage's lines.

import { CHAR_W, LABEL_GAP, LINE_H, STAGE_GAP, type LaidOutNode, type PipelineLayout } from './graph.js';
import type { Pipeline, SourceRange, Stage } from './model.js';

/** Every stage in the pipeline by id, including nested, parallel and matrix stages. */
export function indexStages(stages: Stage[], map = new Map<string, Stage>()) {
  for (const s of stages) {
    map.set(s.id, s);
    if (s.body.kind === 'stages') indexStages(s.body.stages, map);
    if (s.body.kind === 'parallel') indexStages(s.body.branches, map);
    if (s.body.kind === 'matrix') indexStages(s.body.matrix.stages, map);
  }
  return map;
}

/** The innermost stage whose block contains the source offset. */
export function innermostStage(stages: Map<string, Stage>, offset: number) {
  let best: Stage | undefined;
  for (const s of stages.values()) {
    if (offset >= s.loc.start && offset <= s.loc.end && (!best || s.loc.end - s.loc.start < best.loc.end - best.loc.start)) best = s;
  }
  return best;
}

/**
 * Where to drop: before the `index`th stage of a list (`containerId` null is the top-level `stages`),
 * next to a plain parallel branch, which then becomes a wrapper stage running both in sequence,
 * or under a stage that runs in sequence, which then becomes a wrapper stage running both in parallel.
 */
export type DropTarget = { containerId: string | null; index: number } | { wrap: string; after: boolean } | { fork: string };

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface StageEdit {
  /** One replacement that performs the whole move. */
  edit: TextEdit;
  /** Where the moved stage starts in the edited text, to select it afterwards. */
  stageOffset: number;
}

interface StageList {
  stages: Stage[];
  block?: SourceRange;
  parallel: boolean;
  /** Stages in this list sit inside a parallel, so they may not contain parallel or matrix. */
  nested: boolean;
}

interface PipelineIndex {
  stages: Map<string, Stage>;
  lists: Map<string | null, StageList>;
  parent: Map<string, string | null>;
  inMatrix: Set<string>;
}

const indexes = new WeakMap<Pipeline, PipelineIndex>();

function indexPipeline(p: Pipeline): PipelineIndex {
  const cached = indexes.get(p);
  if (cached) return cached;
  const ix: PipelineIndex = { stages: indexStages(p.stages), lists: new Map(), parent: new Map(), inMatrix: new Set() };
  const walk = (stages: Stage[], containerId: string | null, list: StageList | undefined, nested: boolean, inMatrix: boolean) => {
    if (list) ix.lists.set(containerId, list);
    for (const s of stages) {
      ix.parent.set(s.id, containerId);
      if (inMatrix) ix.inMatrix.add(s.id);
      const b = s.body;
      if (b.kind === 'stages') walk(b.stages, s.id, inMatrix ? undefined : { stages: b.stages, block: b.block, parallel: false, nested }, nested, inMatrix);
      if (b.kind === 'parallel') walk(b.branches, s.id, inMatrix ? undefined : { stages: b.branches, block: b.block, parallel: true, nested: true }, true, inMatrix);
      if (b.kind === 'matrix') walk(b.matrix.stages, s.id, undefined, true, true);
    }
  };
  walk(p.stages, null, { stages: p.stages, block: p.stagesBlock, parallel: false, nested: false }, false, false);
  indexes.set(p, ix);
  return ix;
}

const forks = (s: Stage): boolean =>
  s.body.kind === 'parallel' || s.body.kind === 'matrix' || (s.body.kind === 'stages' && s.body.stages.some(forks));

const isPlain = (s: Stage) => s.body.kind === 'steps' || s.body.kind === 'empty';

function isAncestor(ix: PipelineIndex, ancestorId: string, of: string): boolean {
  for (let c: string | null = of; c !== null; c = ix.parent.get(c) ?? null) if (c === ancestorId) return true;
  return false;
}

/**
 * The stage that leaves the source when `s` moves: `s` itself, or, when `s` is the only stage left in a
 * `stages`/`parallel` block, the stage holding that block (and so on up), since Jenkins rejects an empty block.
 * Undefined when that would take the pipeline's last stage.
 */
function leavingStage(ix: PipelineIndex, s: Stage): Stage | undefined {
  let r = s;
  for (;;) {
    const parentId = ix.parent.get(r.id) ?? null;
    const list = ix.lists.get(parentId);
    if (!list || list.stages.length > 1) return r;
    if (parentId === null) return undefined;
    r = ix.stages.get(parentId)!;
  }
}

export function canMove(p: Pipeline, stageId: string, t: DropTarget): boolean {
  const ix = indexPipeline(p);
  const s = ix.stages.get(stageId);
  if (!s || ix.inMatrix.has(stageId)) return false;
  const fromId = ix.parent.get(stageId) ?? null;
  const from = ix.lists.get(fromId);
  if (!from?.block) return false;
  const leaving = leavingStage(ix, s);
  if (!leaving) return false;
  // Nothing can land in a stage that the move removes.
  const anchor = 'wrap' in t ? t.wrap : 'fork' in t ? t.fork : t.containerId;
  if (leaving !== s && anchor !== null && (anchor === leaving.id || isAncestor(ix, leaving.id, anchor))) return false;
  if ('wrap' in t) {
    const a = ix.stages.get(t.wrap);
    if (!a || a === s || ix.inMatrix.has(a.id) || !isPlain(a)) return false;
    const aParent = ix.parent.get(a.id) ?? null;
    const list = ix.lists.get(aParent);
    if (!list?.parallel || !list.block || aParent === null || isAncestor(ix, stageId, aParent)) return false;
    return !forks(s);
  }
  if ('fork' in t) {
    const a = ix.stages.get(t.fork);
    if (!a || a === s || ix.inMatrix.has(a.id) || forks(a) || forks(s)) return false;
    const aParent = ix.parent.get(a.id) ?? null;
    const list = ix.lists.get(aParent);
    return !!list?.block && !list.parallel && !list.nested && (aParent === null || !isAncestor(ix, stageId, aParent));
  }
  const to = ix.lists.get(t.containerId);
  if (!to?.block || t.index < 0 || t.index > to.stages.length) return false;
  if (t.containerId !== null && isAncestor(ix, stageId, t.containerId)) return false;
  if (to.nested && forks(s)) return false;
  if (fromId === t.containerId) {
    const at = from.stages.indexOf(s);
    return t.index !== at && t.index !== at + 1;
  }
  return true;
}

const lineStart = (src: string, o: number) => src.lastIndexOf('\n', o - 1) + 1;
const indentAt = (src: string, o: number) => /^[ \t]*/.exec(src.slice(lineStart(src, o)))![0];

/** The whole lines a stage occupies, with the `//` comment lines right above it. Null when it shares a line with other code. */
function stageLines(src: string, s: Stage): { start: number; end: number } | null {
  let start = lineStart(src, s.loc.start);
  if (src.slice(start, s.loc.start).trim()) return null;
  const nl = src.indexOf('\n', s.loc.end);
  const end = nl === -1 ? src.length : nl + 1;
  const rest = src.slice(s.loc.end, end).trim();
  if (rest && !rest.startsWith('//')) return null;
  while (start > 0) {
    const prev = lineStart(src, start - 1);
    if (!src.slice(prev, start).trim().startsWith('//')) break;
    start = prev;
  }
  return { start, end };
}

const linesText = (src: string, r: { start: number; end: number }) => {
  const t = src.slice(r.start, r.end);
  return t.endsWith('\n') ? t : t + '\n';
};

/** Moves lines indented by `from` to be indented by `to`. */
function reindent(text: string, from: string, to: string): string {
  return text
    .split('\n')
    .map((l) => (!l.trim() ? l : l.startsWith(from) ? to + l.slice(from.length) : to + l.trimStart()))
    .join('\n');
}

/** One level of indentation, as the stage's list uses it. */
function indentUnit(src: string, s: Stage, list: StageList): string {
  const own = indentAt(src, s.loc.start);
  const outer = list.block ? indentAt(src, list.block.start) : '';
  return own.startsWith(outer) && own.length > outer.length ? own.slice(outer.length) : '    ';
}

const groovyQuote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A piece of a move. `mark` is where the moved stage's header lands within `text`. */
interface Part {
  start: number;
  end: number;
  text: string;
  mark?: number;
}

/** Merges non-overlapping parts into one replacement. */
function combine(src: string, parts: Part[]): StageEdit | null {
  const sorted = [...parts].sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start));
  let text = '';
  let stageOffset = -1;
  for (let i = 0; i < sorted.length; i++) {
    const part = sorted[i];
    if (i > 0) {
      if (part.start < sorted[i - 1].end) return null;
      text += src.slice(sorted[i - 1].end, part.start);
    }
    if (part.mark !== undefined) stageOffset = sorted[0].start + text.length + part.mark;
    text += part.text;
  }
  return { edit: { start: sorted[0].start, end: sorted[sorted.length - 1].end, text }, stageOffset };
}

/** The stage's lines, re-indented to `to`, and where its header sits in them. */
function movedText(src: string, s: Stage, lines: { start: number; end: number }, to: string) {
  const from = indentAt(src, s.loc.start);
  return {
    text: reindent(linesText(src, lines), from, to),
    mark: reindent(src.slice(lines.start, lineStart(src, s.loc.start)), from, to).length + to.length,
  };
}

/**
 * Replaces a bare stage that `s` leaves with one stage inside by that stage: a parallel branch's
 * `stages` wrapper, or a one-branch `parallel`. A stage with settings of its own stays.
 */
function unwrapPart(src: string, ix: PipelineIndex, s: Stage): Part | undefined {
  const wId = ix.parent.get(s.id);
  const w = wId ? ix.stages.get(wId) : undefined;
  if (!w) return;
  const inner = w.body.kind === 'stages' ? w.body.stages : w.body.kind === 'parallel' ? w.body.branches : [];
  if (inner.length !== 2) return;
  if (w.body.kind === 'stages' && !ix.lists.get(ix.parent.get(w.id) ?? null)?.parallel) return;
  if (w.agent || w.when || w.input || w.environment || w.options || w.tools || w.post || w.failFast !== undefined) return;
  const rest = inner.find((x) => x !== s)!;
  const wl = stageLines(src, w);
  const rl = stageLines(src, rest);
  if (!wl || !rl) return;
  // Comments above the wrapper stay where they are.
  const start = lineStart(src, w.loc.start);
  return { start, end: wl.end, text: movedText(src, rest, rl, indentAt(src, w.loc.start)).text };
}

/**
 * Replaces stage `a` with a new wrapper stage named after `base` (made unique) that holds `a` and the moved stage `s`,
 * in a `stages` (sequence) or `parallel` block; `after` puts `s` second.
 */
function wrapperPart(
  src: string,
  ix: PipelineIndex,
  a: Stage,
  s: Stage,
  cut: { start: number; end: number },
  unit: string,
  keyword: 'stages' | 'parallel',
  base: string,
  after: boolean,
): Part | null {
  const al = stageLines(src, a);
  if (!al) return null;
  const outer = indentAt(src, a.loc.start);
  const inner = outer + unit + unit;
  const names = new Set([...ix.stages.values()].map((x) => x.name));
  let name = base;
  for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
  const head = `${outer}stage(${groovyQuote(name)}) {\n${outer}${unit}${keyword} {\n`;
  const aText = movedText(src, a, al, inner).text;
  const moved = movedText(src, s, cut, inner);
  const body = after ? aText + moved.text : moved.text + aText;
  return { start: al.start, end: al.end, text: `${head}${body}${outer}${unit}}\n${outer}}\n`, mark: head.length + (after ? aText.length : 0) + moved.mark };
}

export function moveStage(src: string, p: Pipeline, stageId: string, t: DropTarget): StageEdit | null {
  if (!canMove(p, stageId, t)) return null;
  const ix = indexPipeline(p);
  const s = ix.stages.get(stageId)!;
  const fromId = ix.parent.get(stageId) ?? null;
  const from = ix.lists.get(fromId)!;
  const cut = stageLines(src, s);
  if (!cut) return null;
  const unit = indentUnit(src, s, from);

  let place: Part | null;
  if ('wrap' in t) {
    const a = ix.stages.get(t.wrap)!;
    const base = t.after ? `${a.name} → ${s.name}` : `${s.name} → ${a.name}`;
    place = wrapperPart(src, ix, a, s, cut, unit, 'stages', base, t.after);
  } else if ('fork' in t) {
    const a = ix.stages.get(t.fork)!;
    place = wrapperPart(src, ix, a, s, cut, unit, 'parallel', `${a.name} | ${s.name}`, true);
  } else {
    const to = ix.lists.get(t.containerId)!;
    let insertAt: number;
    if (t.index < to.stages.length) {
      const at = stageLines(src, to.stages[t.index]);
      if (!at) return null;
      insertAt = at.start;
    } else {
      const close = to.block!.end - 1;
      insertAt = lineStart(src, close);
      if (src.slice(insertAt, close).trim()) return null; // `}` shares its line with code
    }
    const sibling = to.stages.find((x) => x !== s);
    const indent = sibling ? indentAt(src, sibling.loc.start) : indentAt(src, to.block!.start) + unit;
    const moved = movedText(src, s, cut, indent);
    place = { start: insertAt, end: insertAt, text: moved.text, mark: moved.mark };
  }

  if (!place) return null;
  // A stage emptied by the move goes too, with the comments above it.
  const leaving = leavingStage(ix, s)!;
  const gone = leaving === s ? cut : stageLines(src, leaving);
  if (!gone) return null;
  const sameList = 'containerId' in t && t.containerId === fromId;
  const unwrap = sameList ? undefined : unwrapPart(src, ix, leaving);
  const overlaps = (a: Part, b: Part) => a.start < b.end && b.start < a.end;
  const removal = unwrap && !overlaps(unwrap, place) ? unwrap : { start: gone.start, end: gone.end, text: '' };
  return combine(src, [removal, place]);
}

export function applyEdit(src: string, e: TextEdit): string {
  return src.slice(0, e.start) + e.text + src.slice(e.end);
}

/** Whether the stage's name is a plain string literal that a rename can rewrite (not a GString like "Deploy ${X}"). */
export function canRename(p: Pipeline, stageId: string): boolean {
  const s = indexPipeline(p).stages.get(stageId);
  return !!s?.nameLoc && !s.dynamicName;
}

/** The stage name as it reads, with the literal's backslash escapes resolved. */
export function displayName(s: Stage): string {
  return s.name.replace(/\\(.)/g, '$1');
}

/** Why `name` can't be the stage's new name, or null when it can. */
export function renameError(p: Pipeline, stageId: string, name: string): string | null {
  const s = indexPipeline(p).stages.get(stageId);
  if (!s || !canRename(p, stageId)) return 'This stage cannot be renamed.';
  const n = name.trim();
  if (!n) return 'A stage needs a name.';
  if (/[\r\n]/.test(n)) return 'A stage name must fit on one line.';
  if (n === displayName(s)) return 'The name is unchanged.';
  for (const o of indexPipeline(p).stages.values()) {
    if (o !== s && displayName(o) === n) return `Another stage is already named '${n}'.`;
  }
  return null;
}

/** Rewrites only the stage's name literal, keeping a plain double-quoted name double-quoted. */
export function renameStage(src: string, p: Pipeline, stageId: string, name: string): StageEdit | null {
  if (renameError(p, stageId, name)) return null;
  const s = indexPipeline(p).stages.get(stageId)!;
  const loc = s.nameLoc!;
  const n = name.trim();
  const literal = src.slice(loc.start, loc.end);
  const double = literal.startsWith('"') && !literal.startsWith('"""');
  const text = double ? `"${n.replace(/[\\"$]/g, (c) => `\\${c}`)}"` : groovyQuote(n);
  return { edit: { start: loc.start, end: loc.end, text }, stageOffset: s.loc.start };
}

/** A place a dragged stage can drop: a vertical marker on a rail ('v'), or a horizontal one between parallel branches ('h'). */
export interface DropSlot {
  target: DropTarget;
  x: number;
  y: number;
  /** Marker length: along x for 'h', along y for 'v'. */
  length: number;
  orient: 'h' | 'v';
  /** Anywhere in here counts as on the slot, so a drop needn't land right on the marker. */
  zone?: Rect;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function dropSlots(layout: PipelineLayout, p: Pipeline): DropSlot[] {
  const ix = indexPipeline(p);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, LaidOutNode[]>();
  for (const n of layout.nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);

  const own = (n: LaidOutNode): Rect => {
    if (n.kind === 'group') return { left: n.absX, right: n.absX + n.width, top: n.absY, bottom: n.absY + n.height };
    const cx = n.absX + n.width / 2;
    const half = Math.max(n.width / 2, ...[...n.lines, ...n.sublines].map((l) => (l.length * CHAR_W) / 2));
    return { left: cx - half, right: cx + half, top: n.absY, bottom: n.absY + n.height + LABEL_GAP + (n.lines.length + n.sublines.length) * LINE_H };
  };
  const extent = (n: LaidOutNode): Rect =>
    (kids.get(n.id) ?? [])
      .filter((c) => c.kind !== 'fork' && c.kind !== 'join')
      .map(extent)
      .reduce((a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }), own(n));
  const rail = (n: LaidOutNode): number => {
    if (n.kind !== 'group' || n.rowLabel) return n.absY + n.height / 2;
    const fork = byId.get(`${n.id}::fork`);
    if (fork) return fork.absY;
    const first = (kids.get(n.id) ?? [])[0];
    return first ? rail(first) : n.absY + n.height;
  };

  const slots: DropSlot[] = [];
  for (const [containerId, list] of ix.lists) {
    if (!list.block) continue;
    const members = list.stages.map((s) => byId.get(s.id)).filter((n): n is LaidOutNode => !!n);
    if (members.length !== list.stages.length || !members.length) continue;
    const at = (index: number) => ({ containerId, index });
    if (list.parallel) {
      const fork = byId.get(`${containerId}::fork`);
      const join = byId.get(`${containerId}::join`);
      if (!fork || !join) continue;
      const boxes = members.map(extent);
      const left = fork.absX;
      const length = join.absX - fork.absX;
      for (let i = 0; i <= members.length; i++) {
        const y = i === 0 ? boxes[0].top - 6 : i === members.length ? boxes[i - 1].bottom + 6 : (boxes[i - 1].bottom + boxes[i].top) / 2;
        slots.push({ target: at(i), x: left, y, length, orient: 'h' });
      }
    } else {
      const boxes = members.map(own);
      const rails = members.map(rail);
      const gap = STAGE_GAP / 2;
      for (let i = 0; i <= members.length; i++) {
        if (i === 0) slots.push({ target: at(0), x: boxes[0].left - gap, y: rails[0], length: 28, orient: 'v' });
        else if (i === members.length || rails[i] !== rails[i - 1]) {
          const slot: DropSlot = { target: at(i), x: boxes[i - 1].right + gap, y: rails[i - 1], length: 28, orient: 'v' };
          // The end of a parallel branch's sequence: the rest of the row, up to where the branches join, appends to it.
          const join = containerId !== null && i === members.length ? byId.get(`${ix.parent.get(containerId)}::join`) : undefined;
          if (join && ix.lists.get(ix.parent.get(containerId!) ?? null)?.parallel) slot.zone = railZone(boxes[i - 1].right, join.absX, rails[i - 1]);
          slots.push(slot);
        }
        else slots.push({ target: at(i), x: (boxes[i - 1].right + boxes[i].left) / 2, y: rails[i], length: 28, orient: 'v' });
      }
    }
  }
  // Either side of a plain parallel branch: run the dropped stage before or after it, in a new wrapper.
  for (const n of layout.nodes) {
    if (n.kind !== 'stage' || !n.stageId || n.id !== n.stageId || !n.parentId || ix.inMatrix.has(n.stageId)) continue;
    const fork = byId.get(`${n.parentId}::fork`);
    const join = byId.get(`${n.parentId}::join`);
    if (!fork || !join) continue;
    const y = n.absY + n.height / 2;
    const gap = STAGE_GAP / 2;
    // The branch's whole row counts: left of its centre runs the stage first, right of it after.
    const cx = n.absX + n.width / 2;
    slots.push({ target: { wrap: n.stageId, after: false }, x: Math.max(n.absX - gap, (fork.absX + n.absX) / 2), y, length: 28, orient: 'v', zone: railZone(fork.absX, cx, y) });
    const right = n.absX + n.width;
    slots.push({ target: { wrap: n.stageId, after: true }, x: Math.min(right + gap, (right + join.absX) / 2), y, length: 28, orient: 'v', zone: railZone(cx, join.absX, y) });
  }
  // Under a stage that runs in sequence: run the dropped stage in parallel with it, in a new wrapper.
  for (const n of layout.nodes) {
    if (!n.stageId || n.id !== n.stageId || ix.inMatrix.has(n.stageId)) continue;
    if (n.kind !== 'stage' && !(n.kind === 'group' && n.groupKind === 'stages' && !n.rowLabel)) continue;
    const st = ix.stages.get(n.stageId);
    const list = ix.lists.get(ix.parent.get(n.stageId) ?? null);
    if (!st || forks(st) || !list?.block || list.parallel || list.nested) continue;
    const box = n.kind === 'group' ? extent(n) : own(n);
    slots.push({
      target: { fork: n.stageId },
      x: box.left,
      y: box.bottom + 6,
      length: box.right - box.left,
      orient: 'h',
      zone: { left: box.left, right: box.right, top: box.bottom - 4, bottom: box.bottom + FORK_ZONE },
    });
  }
  return slots;
}

/** Distance from a point to a slot's marker. */
/** A band along a rail, about as tall as a stage circle, so the gaps between parallel rows stay free for new-branch slots. */
const railZone = (left: number, right: number, y: number): Rect => ({ left, right, top: y - RAIL_ZONE, bottom: y + RAIL_ZONE });
const RAIL_ZONE = 12;
/** How far under a stage's label a drop still runs it in parallel with that stage. */
const FORK_ZONE = 28;

export function slotDistance(s: DropSlot, px: number, py: number): number {
  const z = s.zone;
  if (z && px >= z.left && px <= z.right && py >= z.top && py <= z.bottom) return 0;
  if (s.orient === 'v') return Math.hypot(px - s.x, py - s.y);
  const cx = Math.max(s.x, Math.min(s.x + s.length, px));
  return Math.hypot(px - cx, py - s.y);
}
