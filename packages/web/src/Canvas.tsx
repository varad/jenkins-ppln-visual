import { useEffect, useMemo } from 'react';
import { toSvg, type Pipeline } from '@jpv/core';
import { useWrappedLayout } from './useWrappedLayout';

interface Props {
  pipeline: Pipeline;
  wrap: boolean;
  selectedStageId?: string;
  onSelect: (stageId: string | undefined) => void;
}

export function Canvas({ pipeline, wrap, selectedStageId, onSelect }: Props) {
  const { container, setContainer, layout } = useWrappedLayout(pipeline, wrap);
  const svg = useMemo(() => (layout ? toSvg(layout) : ''), [layout]);

  useEffect(() => {
    container?.querySelectorAll('[data-stage-id]').forEach((el) => {
      el.classList.toggle('selected', el.getAttribute('data-stage-id') === selectedStageId);
    });
  }, [container, svg, selectedStageId]);

  return (
    <div
      ref={setContainer}
      className="svg-preview"
      // toSvg escapes all text taken from the Jenkinsfile.
      dangerouslySetInnerHTML={{ __html: svg }}
      onClick={(e) => onSelect((e.target as Element).closest('[data-stage-id]')?.getAttribute('data-stage-id') ?? undefined)}
    />
  );
}
