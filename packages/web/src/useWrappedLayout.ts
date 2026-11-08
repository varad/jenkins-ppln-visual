import { useEffect, useState } from 'react';
import { buildGraph, layoutGraph, type Pipeline, type PipelineLayout } from '@jpv/core';

/** With wrap on, lays the pipeline out to fit the element passed to setContainer, and again whenever it resizes. */
export function useWrappedLayout(pipeline: Pipeline | null | undefined, wrap: boolean) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<PipelineLayout | null>(null);

  useEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.floor(entry.contentRect.width);
      // A hidden element measures 0; keep the last layout until it is visible again.
      if (measured > 0) setWidth(measured);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const maxWidth = wrap ? width : undefined;

  useEffect(() => {
    if (!pipeline) {
      setLayout(null);
      return;
    }
    if (maxWidth === 0) return; // not measured yet
    let cancelled = false;
    layoutGraph(buildGraph(pipeline), { maxWidth })
      .then((l) => !cancelled && setLayout(l))
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [pipeline, maxWidth]);

  return { container, setContainer, layout };
}
