import { useEffect, useRef } from 'react';
import { canMove, canRemove, dropSlots, moveStage, removeStage, slotDistance, type DropSlot, type Pipeline, type PipelineLayout, type StageEdit } from '@jpv/core';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Pointer travel before a press on a stage becomes a drag, so plain clicks still select. */
const DRAG_THRESHOLD = 4;
/** How close to a drop slot the pointer has to be, in SVG units. */
const SNAP = 40;
/** Window event an embedding host sends when it saw a release the page missed; `detail.drop` drops rather than cancels. */
export const RELEASE_POINTER = 'jpv-release-pointer';

/**
 * Draws a copy of a stage in a small SVG of its own, fixed over the stage's place on screen.
 * The copy used to live in the diagram's SVG with overflow: visible so it could leave the drawing,
 * but paint outside an SVG's box is not reliably invalidated: in off-screen JCEF (IntelliJ on Windows)
 * every frame of the drag stayed behind as clipped fragments of circles and labels.
 */
function makeGhost(svg: SVGSVGElement, g: SVGGraphicsElement): HTMLDivElement {
  const PAD = 6;
  const box = g.getBBox();
  const ctm = g.getScreenCTM() ?? new DOMMatrix();
  const scale = Math.hypot(ctm.a, ctm.b) || 1;
  const topLeft = new DOMPoint(box.x - PAD, box.y - PAD).matrixTransform(ctm);
  const w = box.width + 2 * PAD;
  const h = box.height + 2 * PAD;
  const el = document.createElement('div');
  el.className = 'jpv-drop-ghost';
  el.style.left = `${topLeft.x}px`;
  el.style.top = `${topLeft.y}px`;
  const ghostSvg = document.createElementNS(SVG_NS, 'svg');
  ghostSvg.setAttribute('width', String(w * scale));
  ghostSvg.setAttribute('height', String(h * scale));
  ghostSvg.setAttribute('viewBox', `${box.x - PAD} ${box.y - PAD} ${w} ${h}`);
  const font = svg.getAttribute('font-family');
  if (font) ghostSvg.setAttribute('font-family', font);
  const copy = g.cloneNode(true) as SVGGElement;
  copy.removeAttribute('data-stage-id');
  copy.removeAttribute('transform'); // getBBox and the viewBox are in the stage's own coordinates
  copy.removeAttribute('class');
  copy.querySelector('title')?.remove();
  ghostSvg.append(copy);
  el.append(ghostSvg);
  return el;
}

interface Options {
  container: HTMLDivElement | null;
  layout: PipelineLayout | null;
  pipeline: Pipeline | undefined;
  /** The text `pipeline` was parsed from. */
  source: string;
  onMove: (move: StageEdit) => void;
  /** Set to offer a trash area while dragging; dropping a stage on it removes the stage. */
  onRemove?: (removal: StageEdit) => void;
  onDragChange?: (dragging: boolean) => void;
}

/**
 * Lets the user drag a stage in the rendered diagram to another place in a sequence or parallel.
 * Works on the SVG that toSvg produced; the drop markers live in a DOM-only overlay.
 */
export function useStageDrag({ container, layout, pipeline, source, onMove, onRemove, onDragChange }: Options) {
  const cb = useRef({ onMove, onRemove, onDragChange });
  cb.current = { onMove, onRemove, onDragChange };
  const removable = !!onRemove;

  useEffect(() => {
    const svg = container?.querySelector('svg');
    if (!container || !svg || !layout || !pipeline) return;
    const slots = dropSlots(layout, pipeline);
    const movable = new Set<string>();
    container.querySelectorAll('[data-stage-id]').forEach((g) => {
      const id = g.getAttribute('data-stage-id')!;
      // Matrix cells repeat one stage under its id; canMove rejects those.
      if (!movable.has(id) && ((removable && canRemove(pipeline, id)) || slots.some((s) => canMove(pipeline, id, s.target)))) movable.add(id);
    });
    container.querySelectorAll('[data-stage-id]').forEach((g) => g.classList.toggle('movable', movable.has(g.getAttribute('data-stage-id')!)));

    let press: { id: string; g: Element; x: number; y: number; start: DOMPoint; pointerId: number } | null = null;
    let drag: {
      overlay: SVGGElement;
      /** A copy of the stage in its own fixed-position element, so moving it never repaints the diagram. */
      ghost: HTMLDivElement;
      marker: SVGLineElement;
      slot?: DropSlot;
      trash?: HTMLDivElement;
      overTrash?: boolean;
      /** The pointer capture went away without a pointerup, so the pointer may have been let go anywhere. */
      captureLost?: boolean;
    } | null = null;
    let swallowClick = false;

    const toSvg = (e: PointerEvent) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()?.inverse());

    const end = () => {
      if (drag) {
        drag.overlay.remove();
        drag.trash?.remove();
        drag.ghost.remove();
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
      // The button is up but no pointerup arrived: an embedding host (out-of-process JCEF) can lose it.
      // End the press here, or the next mouse move would start, or keep dragging, a stage with no button held.
      if ((e.buttons & 1) === 0) {
        // Drop where the previous move left it, unless the capture was lost too and the release could have been anywhere.
        if (drag?.captureLost) cancel();
        else finish();
        return;
      }
      if (!drag) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
        container.setPointerCapture(press.pointerId);
        const overlay = document.createElementNS(SVG_NS, 'g');
        overlay.setAttribute('class', 'jpv-drop');
        overlay.setAttribute('pointer-events', 'none');
        const marker = document.createElementNS(SVG_NS, 'line');
        marker.setAttribute('class', 'jpv-drop-marker');
        marker.setAttribute('visibility', 'hidden');
        overlay.append(marker);
        svg.append(overlay);
        const ghost = makeGhost(svg, press.g as SVGGraphicsElement);
        document.body.append(ghost);
        press.g.classList.add('dragging');
        container.classList.add('dragging-stage');
        drag = { overlay, ghost, marker };
        if (removable && canRemove(pipeline, press.id)) {
          // Fixed to the window, at the bottom of the visible diagram, however far it is scrolled.
          const r = container.getBoundingClientRect();
          const trash = document.createElement('div');
          trash.className = 'jpv-trash';
          trash.textContent = '🗑 Drop here to remove';
          trash.style.left = `${r.left + r.width / 2}px`;
          trash.style.bottom = `${window.innerHeight - r.bottom + 16}px`;
          document.body.append(trash);
          drag.trash = trash;
        }
        cb.current.onDragChange?.(true);
      }
      const at = toSvg(e);
      drag.ghost.style.transform = `translate(${e.clientX - press.x}px,${e.clientY - press.y}px)`;
      const t = drag.trash?.getBoundingClientRect();
      drag.overTrash = !!t && e.clientX >= t.left && e.clientX <= t.right && e.clientY >= t.top && e.clientY <= t.bottom;
      drag.trash?.classList.toggle('active', drag.overTrash);
      drag.ghost.classList.toggle('removing', drag.overTrash);
      if (drag.overTrash) {
        drag.slot = undefined;
        drag.marker.setAttribute('visibility', 'hidden');
        return;
      }
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

    /** Ends the press; a drag drops where the last move left it. */
    const finish = () => {
      if (drag) {
        swallowClick = true;
        const id = press?.id;
        const removal = drag.overTrash && id ? removeStage(source, pipeline, id) : null;
        const move = !removal && drag.slot && id ? moveStage(source, pipeline, id, drag.slot.target) : null;
        end();
        if (removal) cb.current.onRemove?.(removal);
        else if (move) cb.current.onMove(move);
      } else end();
    };

    // A drag that loses the window's focus without a pointerup is cancelled, not left hanging.
    const cancel = () => {
      if (!drag) {
        press = null;
        return;
      }
      swallowClick = true;
      end();
    };

    // Not cancelled outright: a host may drop the capture while the button is still held.
    const onLostCapture = () => {
      if (drag) drag.captureLost = true;
    };

    const onHostRelease = (e: Event) => {
      if ((e as CustomEvent<{ drop: boolean }>).detail?.drop) finish();
      else cancel();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };

    // Capture phase, so the click that ends a drag never reaches the selection handler.
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
    };

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMoveEvt);
    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', end);
    container.addEventListener('lostpointercapture', onLostCapture);
    container.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancel);
    window.addEventListener(RELEASE_POINTER, onHostRelease);
    return () => {
      end();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMoveEvt);
      container.removeEventListener('pointerup', finish);
      container.removeEventListener('pointercancel', end);
      container.removeEventListener('lostpointercapture', onLostCapture);
      container.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancel);
      window.removeEventListener(RELEASE_POINTER, onHostRelease);
    };
  }, [container, layout, pipeline, source, removable]);
}
