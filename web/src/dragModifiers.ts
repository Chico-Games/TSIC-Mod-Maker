import type { Modifier } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';

// dnd-kit's DragOverlay container is sized to the source draggable's rect, and
// rendered at the source's original position plus a transform tracking cursor
// movement. When the source is large (e.g. a wide recipe card) and our ghost
// is small, the ghost sits at the top-left corner of a giant invisible box and
// appears far above the cursor.
//
// This modifier rewrites the transform so the overlay's top-left tracks the
// cursor with a small offset, regardless of source size.
export const followCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const c = getEventCoordinates(activatorEvent);
  if (!c) return transform;

  // Where on the source the user grabbed (relative to its top-left).
  const grabOffsetX = c.x - draggingNodeRect.left;
  const grabOffsetY = c.y - draggingNodeRect.top;

  // Default transform places the overlay's top-left at:
  //   sourcePos + transform = sourcePos + (cursor - initialCursor)
  // We want overlay's top-left at (cursor + 12, cursor + 12) so the ghost
  // appears just below-right of the pointer.
  // Adding (grabOffsetX + 12, grabOffsetY + 12) to the transform achieves this.
  return {
    ...transform,
    x: transform.x + grabOffsetX + 12,
    y: transform.y + grabOffsetY + 12,
  };
};
