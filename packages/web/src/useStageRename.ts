import { useEffect, useRef } from 'react';
import { canRename, displayName, indexStages, renameError, renameStage, translator, type Pipeline, type PipelineLayout, type StageEdit } from '@jpv/core';
import { useLocale } from './i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const MIN_W = 120;
const H = 24;

interface Options {
  container: HTMLDivElement | null;
  layout: PipelineLayout | null;
  pipeline: Pipeline | undefined;
  /** The text `pipeline` was parsed from. */
  source: string;
  onRename: (edit: StageEdit) => void;
  /** The name box opened; an embedding host may need to hand keyboard focus to the page. */
  onEditStart?: () => void;
}

/**
 * Lets the user double-click a stage's label in the rendered diagram to rename it.
 * The name box lives in a DOM-only overlay, like the drag markers, so toSvg output never contains it.
 */
export function useStageRename({ container, layout, pipeline, source, onRename, onEditStart }: Options) {
  const locale = useLocale();
  const cb = useRef({ onRename, onEditStart, locale });
  cb.current = { onRename, onEditStart, locale };

  useEffect(() => {
    const svg = container?.querySelector('svg');
    if (!container || !svg || !layout || !pipeline) return;
    const stages = indexStages(pipeline.stages);
    container.querySelectorAll('[data-stage-id]').forEach((g) => g.classList.toggle('renamable', canRename(pipeline, g.getAttribute('data-stage-id')!)));
    let box: SVGForeignObjectElement | null = null;

    const close = () => {
      const b = box;
      box = null; // first, so the blur that removing a focused input fires is ignored
      b?.remove();
    };

    const open = (g: Element, id: string) => {
      close();
      const stage = stages.get(id)!;
      const texts = [...g.querySelectorAll(':scope > text:not([data-tags])')] as SVGTextElement[];
      const boxes = (texts.length ? texts : [g as SVGGraphicsElement]).map((t) => t.getBBox());
      const left = Math.min(...boxes.map((b) => b.x));
      const right = Math.max(...boxes.map((b) => b.x + b.width));
      const top = Math.min(...boxes.map((b) => b.y));
      const bottom = Math.max(...boxes.map((b) => b.y + b.height));
      const w = Math.max(MIN_W, right - left + 24);
      const x = Math.min(Math.max(0, (left + right) / 2 - w / 2), Math.max(0, layout.width - w));

      const fo = document.createElementNS(SVG_NS, 'foreignObject');
      fo.setAttribute('class', 'jpv-rename');
      Object.entries({ x, y: (top + bottom) / 2 - H / 2, width: w, height: H }).forEach(([k, v]) => fo.setAttribute(k, String(v)));
      const input = document.createElementNS(XHTML_NS, 'input') as HTMLInputElement;
      input.type = 'text';
      input.spellcheck = false;
      input.value = displayName(stage);
      input.setAttribute('aria-label', translator(cb.current.locale)('ui.stageName'));
      fo.append(input);
      // Keep the page's selection, hover and drag handlers out of the name box.
      for (const type of ['click', 'dblclick', 'pointerdown', 'mousedown', 'mouseover']) fo.addEventListener(type, (e) => e.stopPropagation());

      const validate = () => {
        const err = input.value.trim() === displayName(stage) ? null : renameError(pipeline, id, input.value, cb.current.locale);
        input.classList.toggle('invalid', !!err);
        input.title = err ?? '';
        return err;
      };
      const commit = () => {
        if (validate()) return false;
        const edit = renameStage(source, pipeline, id, input.value);
        close();
        if (edit) cb.current.onRename(edit);
        return true;
      };
      input.addEventListener('input', validate);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
      input.addEventListener('blur', () => {
        // Focus leaving the whole page (an IDE taking it, a window switch) keeps the box open.
        if (box !== fo || !document.hasFocus()) return;
        if (!commit()) close();
      });

      svg.append(fo);
      box = fo;
      cb.current.onEditStart?.();
      input.focus();
      input.select();
    };

    const onDblClick = (e: MouseEvent) => {
      const g = (e.target as Element).closest('[data-stage-id]');
      const id = g?.getAttribute('data-stage-id');
      if (!g || !id || !canRename(pipeline, id)) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges(); // a double-click selects the label's text
      open(g, id);
    };

    container.addEventListener('dblclick', onDblClick);
    return () => {
      close();
      container.removeEventListener('dblclick', onDblClick);
    };
  }, [container, layout, pipeline, source]);
}
