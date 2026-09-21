import { useRef, useState } from "react";
import {
  COLUMN_DRAG_THRESHOLD_PX,
  COLUMN_DROP_MIDPOINT_DIVISOR,
  POST_DRAG_CLICK_DELAY_MS,
} from "../constants";

// Pointer-based drag-to-reorder, shared between the sheet panel (vertical) and
// the file tab strip (horizontal). Mirrors ColumnPanel's column reordering.
export function useDragReorder({ selector, axis, onMove }) {
  const [draggedItem, setDraggedItem] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const dragStateRef = useRef(null);
  const dropTargetRef = useRef(null);
  const ignoreClickUntilRef = useRef(0);

  function clearDrag() {
    dragStateRef.current = null;
    dropTargetRef.current = null;
    setDraggedItem(null);
    setDropTarget(null);
  }

  function handlePointerDown(item) {
    return (event) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        item,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
    };
  }

  function handlePointerMove(event) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.active) {
      const distance = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
      );
      if (distance < COLUMN_DRAG_THRESHOLD_PX) return;
      drag.active = true;
      setDraggedItem(drag.item);
    }

    event.preventDefault();
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest(selector);
    const targetItem = row?.dataset.item;
    if (!targetItem || targetItem === drag.item) {
      dropTargetRef.current = null;
      setDropTarget(null);
      return;
    }

    const bounds = row.getBoundingClientRect();
    const position =
      axis === "x"
        ? event.clientX < bounds.left + bounds.width / COLUMN_DROP_MIDPOINT_DIVISOR
          ? "before"
          : "after"
        : event.clientY < bounds.top + bounds.height / COLUMN_DROP_MIDPOINT_DIVISOR
          ? "before"
          : "after";
    const nextTarget = { item: targetItem, position };
    dropTargetRef.current = nextTarget;
    setDropTarget((current) =>
      current?.item === targetItem && current.position === position
        ? current
        : nextTarget,
    );
  }

  function handlePointerUp(event) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.active) {
      const target = dropTargetRef.current;
      if (target) onMove(drag.item, target.item, target.position);
      ignoreClickUntilRef.current = performance.now() + POST_DRAG_CLICK_DELAY_MS;
    }
    clearDrag();
  }

  function shouldIgnoreClick() {
    return performance.now() < ignoreClickUntilRef.current;
  }

  return {
    draggedItem,
    dropTarget,
    shouldIgnoreClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel: clearDrag,
  };
}
