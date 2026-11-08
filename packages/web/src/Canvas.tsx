import { useEffect, useMemo, useRef } from 'react';
import { toSvg, type PipelineLayout } from '@jpv/core';

interface Props {
  layout: PipelineLayout | null;
  selectedStageId?: string;
  onSelect: (stageId: string | undefined) => void;
}

export function Canvas({ layout, selectedStageId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const svg = useMemo(() => (layout ? toSvg(layout) : ''), [layout]);

  useEffect(() => {
    container.current?.querySelectorAll('[data-stage-id]').forEach((el) => {
      el.classList.toggle('selected', el.getAttribute('data-stage-id') === selectedStageId);
    });
  }, [svg, selectedStageId]);

  return (
    <div
      ref={container}
      className="svg-preview"
      // toSvg escapes all text taken from the Jenkinsfile.
      dangerouslySetInnerHTML={{ __html: svg }}
      onClick={(e) => onSelect((e.target as Element).closest('[data-stage-id]')?.getAttribute('data-stage-id') ?? undefined)}
    />
  );
}
