import type { Stage } from '@jpv/core';

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
