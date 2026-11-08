import { useEffect, useMemo } from 'react';
import { toSvg, type Pipeline } from '@jpv/core';
import { useWrappedLayout } from './useWrappedLayout';

interface Props {
  pipeline: Pipeline;
  wrap: boolean;
  selectedStageId?: string;
  onSelect: (stageId: string | undefined) => void;
  onPostClick: () => void;
}

export function Canvas({ pipeline, wrap, selectedStageId, onSelect, onPostClick }: Props) {
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
      onClick={(e) => {
        const target = e.target as Element;
        onSelect(target.closest('[data-stage-id]')?.getAttribute('data-stage-id') ?? undefined);
        if (target.closest('[data-post]')) onPostClick();
      }}
    />
  );
}
