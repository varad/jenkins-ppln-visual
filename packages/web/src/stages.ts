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
