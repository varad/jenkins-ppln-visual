import { useEffect, useRef } from 'react';
import { canMove, dropSlots, moveStage, slotDistance, type DropSlot, type Pipeline, type PipelineLayout, type StageMove } from '@jpv/core';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Pointer travel before a press on a stage becomes a drag, so plain clicks still select. */
const DRAG_THRESHOLD = 4;
/** How close to a drop slot the pointer has to be, in SVG units. */
const SNAP = 40;

interface Options {
  container: HTMLDivElement | null;
  layout: PipelineLayout | null;
  pipeline: Pipeline | undefined;
  /** The text `pipeline` was parsed from. */
  source: string;
  onMove: (move: StageMove) => void;
  onDragChange?: (dragging: boolean) => void;
}

/**
 * Lets the user drag a stage in the rendered diagram to another place in a sequence or parallel.
 * Works on the SVG that toSvg produced; the drop markers live in a DOM-only overlay.
 */
export function useStageDrag({ container, layout, pipeline, source, onMove, onDragChange }: Options) {
  const cb = useRef({ onMove, onDragChange });
  cb.current = { onMove, onDragChange };

  useEffect(() => {
    const svg = container?.querySelector('svg');
    if (!container || !svg || !layout || !pipeline) return;
    const slots = dropSlots(layout, pipeline);
    const movable = new Set<string>();
    container.querySelectorAll('[data-stage-id]').forEach((g) => {
      const id = g.getAttribute('data-stage-id')!;
      // Matrix cells repeat one stage under its id; canMove rejects those.
      if (!movable.has(id) && slots.some((s) => canMove(pipeline, id, s.target))) movable.add(id);
    });
    container.querySelectorAll('[data-stage-id]').forEach((g) => g.classList.toggle('movable', movable.has(g.getAttribute('data-stage-id')!)));

    let press: { id: string; g: Element; x: number; y: number; start: DOMPoint; pointerId: number } | null = null;
    let drag: { overlay: SVGGElement; ghost: SVGGElement; marker: SVGLineElement; slot?: DropSlot } | null = null;
    let swallowClick = false;

    const toSvg = (e: PointerEvent) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()?.inverse());

    const end = () => {
      if (drag) {
        drag.overlay.remove();
        press?.g.classList.remove('dragging');
        container.classList.remove('dragging-stage');
        cb.current.onDragChange?.(false);
      }
      if (press && container.hasPointerCapture(press.pointerId)) container.releasePointerCapture(press.pointerId);
      press = null;
      drag = null;
    };

    const onDown = (e: PointerEvent) => {
      swallowClick = false;
      if (e.button !== 0) return;
      const g = (e.target as Element).closest('[data-stage-id]');
      const id = g?.getAttribute('data-stage-id');
      if (!g || !id || !movable.has(id)) return;
      e.preventDefault(); // no text selection while dragging
      press = { id, g, x: e.clientX, y: e.clientY, start: toSvg(e), pointerId: e.pointerId };
    };

    const onMoveEvt = (e: PointerEvent) => {
      if (!press) return;
      if (!drag) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
        container.setPointerCapture(press.pointerId);
        const overlay = document.createElementNS(SVG_NS, 'g');
        overlay.setAttribute('class', 'jpv-drop');
        overlay.setAttribute('pointer-events', 'none');
        const marker = document.createElementNS(SVG_NS, 'line');
        marker.setAttribute('class', 'jpv-drop-marker');
        marker.setAttribute('visibility', 'hidden');
        const ghost = press.g.cloneNode(true) as SVGGElement;
        ghost.removeAttribute('data-stage-id');
        ghost.querySelector('title')?.remove();
        ghost.setAttribute('class', 'jpv-drop-ghost');
        overlay.append(marker, ghost);
        svg.append(overlay);
        press.g.classList.add('dragging');
        container.classList.add('dragging-stage');
        drag = { overlay, ghost, marker };
        cb.current.onDragChange?.(true);
      }
      const at = toSvg(e);
      drag.ghost.setAttribute('transform', `translate(${at.x - press.start.x},${at.y - press.start.y})`);
      const id = press.id;
      let best: DropSlot | undefined;
      let bestD = SNAP;
      for (const s of slots) {
        const d = slotDistance(s, at.x, at.y);
        if (d < bestD && canMove(pipeline, id, s.target)) {
          best = s;
          bestD = d;
        }
      }
      drag.slot = best;
      const m = drag.marker;
      if (!best) m.setAttribute('visibility', 'hidden');
      else {
        const [x1, y1, x2, y2] = best.orient === 'v' ? [best.x, best.y - best.length / 2, best.x, best.y + best.length / 2] : [best.x, best.y, best.x + best.length, best.y];
        Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => m.setAttribute(k, String(v)));
        m.setAttribute('visibility', 'visible');
      }
    };

    const onUp = () => {
      if (drag) {
        swallowClick = true;
        const move = drag.slot && press ? moveStage(source, pipeline, press.id, drag.slot.target) : null;
        end();
        if (move) cb.current.onMove(move);
      } else end();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag) {
        swallowClick = true;
        end();
      }
    };

    // Capture phase, so the click that ends a drag never reaches the selection handler.
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
    };

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMoveEvt);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', end);
    container.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      end();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMoveEvt);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', end);
      container.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [container, layout, pipeline, source]);
}
