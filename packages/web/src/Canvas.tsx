import { useEffect, useMemo } from 'react';
import { toSvg, type Pipeline, type StageEdit } from '@jpv/core';
import { useStageDrag } from './useStageDrag';
import { useStageRename } from './useStageRename';
import { useWrappedLayout } from './useWrappedLayout';

interface Props {
  pipeline: Pipeline;
  /** The text `pipeline` was parsed from, which stage moves and renames edit. */
  source: string;
  wrap: boolean;
  selectedStageId?: string;
  onSelect: (stageId: string | undefined) => void;
  onPostClick: () => void;
  onEdit: (edit: StageEdit) => void;
}

export function Canvas({ pipeline, source, wrap, selectedStageId, onSelect, onPostClick, onEdit }: Props) {
  const { container, setContainer, layout } = useWrappedLayout(pipeline, wrap);
  const svg = useMemo(() => (layout ? toSvg(layout) : ''), [layout]);
  useStageDrag({ container, layout, pipeline, source, onMove: onEdit, onRemove: onEdit });
  useStageRename({ container, layout, pipeline, source, onRename: onEdit });

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
