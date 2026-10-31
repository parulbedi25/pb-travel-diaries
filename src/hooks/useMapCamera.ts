import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clampZoom, panView, zoomViewAt, type MapView } from "../utils/mercator";

/**
 * A map the visitor can move.
 *
 * Every map on this site is drawn from a view we choose — the tiles underneath
 * and the pins on top are placed by the same projection — so "letting somebody
 * move the map" is one piece of state, not a map library's panes. `fit` is the
 * view the page works out for itself (the whole ride, the places found nearby,
 * the bike's own ping); this hook adds a camera on top of it:
 *
 *  - **Drag** with one pointer — mouse, pen or finger. A click-and-hold moves
 *    the map, exactly like paper under the hand.
 *  - **Pinch** with two fingers, about the point between them.
 *  - **Wheel** zooms about the cursor, so a street under the pointer stays
 *    under it.
 *  - **Double-click** (or double-tap) zooms one step, about the click.
 *  - **Buttons** for both: `zoomIn`, `zoomOut` and `reset`, because a laptop
 *    trackpad, a phone in the sun and a keyboard-only visitor should all be
 *    able to see the petrol pump they are looking for.
 *
 * Until somebody touches it, the map follows `fit` — so a new tab, a new stop
 * or a fresh ping re-frames the page by itself. Once it has been moved, `moved`
 * is true and `reset` puts it back on the fit.
 *
 * Gestures are bound to one element (`bind`), and anything inside marked
 * `data-map-no-pan` is left alone: the list that lives on the nearby map
 * scrolls, and its rows are pressed, not dragged.
 */
export interface MapCamera {
  /** The view to draw: the fit, or where the visitor has moved it to. */
  view: MapView;
  /** True once the visitor has panned or zoomed. */
  moved: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Back to the view the page fitted for itself. */
  reset: () => void;
  /** Put a place in the middle of the map, never zooming out to do it. */
  centerOn: (point: { lat: number; lng: number }, zoom?: number) => void;
  /** Handlers and style for the element the map fills. */
  bind: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
    onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
    /** The map owns the gesture; the page does not scroll underneath it. */
    style: { touchAction: "none" };
  };
}

/** How far a press must travel before it is a drag rather than a tap. */
const DRAG_SLOP_PX = 3;
/** Pixels of movement that make one zoom level on a trackpad. */
const WHEEL_PX_PER_LEVEL = 260;

/** An element the map must not steal gestures from. */
function ownsItself(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return Boolean(element.closest("[data-map-no-pan], button, a, input, select, textarea"));
}

interface Finger {
  x: number;
  y: number;
}

export function useMapCamera(
  fit: MapView,
  {
    width,
    height,
    resetKey = "",
    hostRef,
  }: {
    /** Pixels of the panel, so a zoom can be anchored to a point in it. */
    width: number;
    height: number;
    /** Change this and the map goes back to following `fit`. */
    resetKey?: string;
    /** The element the map fills — where the wheel listener is attached. */
    hostRef?: React.RefObject<HTMLDivElement | null>;
  } = { width: 0, height: 0 },
): MapCamera {
  const [camera, setCamera] = useState<MapView | null>(null);
  const view = camera ?? fit;

  // Readers inside event handlers must see the newest view, not the one their
  // closure was rendered with.
  const viewRef = useRef(view);
  viewRef.current = view;
  const frame = useRef(0);
  const pending = useRef<MapView | null>(null);

  /** One write per animation frame, however many move events arrive. */
  const push = useCallback((next: MapView) => {
    viewRef.current = next;
    pending.current = next;
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      const value = pending.current;
      pending.current = null;
      if (value) setCamera(value);
    });
  }, []);

  useEffect(
    () => () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
    },
    [],
  );

  // A new tab, a new stop, a new search: that is a new map, not the old one
  // viewed from where the last visitor left it.
  useEffect(() => {
    setCamera(null);
    pending.current = null;
  }, [resetKey]);

  const reset = useCallback(() => {
    setCamera(null);
    viewRef.current = fit;
    pending.current = null;
  }, [fit]);

  const zoomTo = useCallback(
    (zoom: number) => {
      const current = viewRef.current;
      push(zoomViewAt(current, zoom, { x: width / 2, y: height / 2 }, width, height));
    },
    [height, push, width],
  );

  const centerOn = useCallback(
    (point: { lat: number; lng: number }, zoom = 14) => {
      push({
        lat: point.lat,
        lng: point.lng,
        zoom: clampZoom(Math.max(viewRef.current.zoom, zoom)),
      });
    },
    [push],
  );

  const zoomIn = useCallback(() => zoomTo(clampZoom(viewRef.current.zoom + 1)), [zoomTo]);
  const zoomOut = useCallback(() => zoomTo(clampZoom(viewRef.current.zoom - 1)), [zoomTo]);

  /* ---------------------------------------------------------------- *
   * Pointers: one to drag, two to pinch
   * ---------------------------------------------------------------- */

  const ownNode = useRef<HTMLDivElement | null>(null);
  const node = hostRef ?? ownNode;
  const pointers = useRef(new Map<number, Finger>());
  /** Where the gesture started, for the slop test and for the scale. */
  const gesture = useRef<{
    startX: number;
    startY: number;
    dragging: boolean;
    /** Distance between the two fingers when the pinch began. */
    pinchKm: number;
    pinchView: MapView | null;
  }>({ startX: 0, startY: 0, dragging: false, pinchKm: 0, pinchView: null });

  const bind = useMemo(
    () => ({
      style: { touchAction: "none" } as const,
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        if (ownsItself(event.target)) return;
        // No text selection, no native image drag: this press belongs to the
        // map until it is let go. The click still fires, so a pin on top of the
        // map stays a pin.
        event.preventDefault();
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 1) {
          gesture.current.startX = event.clientX;
          gesture.current.startY = event.clientY;
          gesture.current.dragging = false;
        }
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          gesture.current.pinchKm = Math.hypot(a.x - b.x, a.y - b.y);
          gesture.current.pinchView = viewRef.current;
        }
        // Capture so a drag that leaves the panel still ends here rather than
        // sticking to whatever the pointer happens to be over.
        try {
          node.current?.setPointerCapture(event.pointerId);
        } catch {
          // A browser that will not capture still gets the drag; it just ends
          // when the pointer leaves.
        }
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const seen = pointers.current.get(event.pointerId);
        if (!seen) return;
        const dx = event.clientX - seen.x;
        const dy = event.clientY - seen.y;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        // Two fingers: pinch about the point between them.
        if (pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const basis = gesture.current.pinchView ?? viewRef.current;
          if (gesture.current.pinchKm > 8 && distance > 8) {
            const ratio = distance / gesture.current.pinchKm;
            const next = clampZoom(basis.zoom + Math.log2(ratio));
            const box = node.current?.getBoundingClientRect();
            const middle = box
              ? {
                  x: (a.x + b.x) / 2 - box.left,
                  y: (a.y + b.y) / 2 - box.top,
                }
              : { x: width / 2, y: height / 2 };
            push(zoomViewAt(viewRef.current, next, middle, width, height));
          }
          return;
        }

        if (!gesture.current.dragging) {
          const travelled = Math.hypot(
            event.clientX - gesture.current.startX,
            event.clientY - gesture.current.startY,
          );
          if (travelled < DRAG_SLOP_PX) return;
          gesture.current.dragging = true;
        }
        push(panView(viewRef.current, dx, dy));
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) gesture.current.pinchView = null;
        if (pointers.current.size === 0) gesture.current.dragging = false;
        try {
          node.current?.releasePointerCapture(event.pointerId);
        } catch {
          // Already released by the browser.
        }
      },
      onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size === 0) gesture.current.dragging = false;
      },
      onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => {
        if (ownsItself(event.target)) return;
        const box = node.current?.getBoundingClientRect();
        const at = box
          ? { x: event.clientX - box.left, y: event.clientY - box.top }
          : { x: width / 2, y: height / 2 };
        push(zoomViewAt(viewRef.current, clampZoom(viewRef.current.zoom + 1), at, width, height));
      },
    }),
    [height, node, push, width],
  );

  /* ---------------------------------------------------------------- *
   * The wheel
   * ---------------------------------------------------------------- */

  // Attached by hand rather than through React: a wheel listener added as a
  // prop is passive in several browsers, and a passive one cannot stop the page
  // scrolling while it zooms the map.
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  useEffect(() => {
    const element = node.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (ownsItself(event.target)) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1;
      const levels = (-event.deltaY * scale) / WHEEL_PX_PER_LEVEL;
      const { width: w, height: h } = sizeRef.current;
      const next = clampZoom(viewRef.current.zoom + levels);
      push(
        zoomViewAt(
          viewRef.current,
          next,
          { x: event.clientX - box.left, y: event.clientY - box.top },
          w,
          h,
        ),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [push]);

  return {
    view,
    moved: camera !== null,
    zoomIn,
    zoomOut,
    reset,
    centerOn,
    bind,
  };
}
