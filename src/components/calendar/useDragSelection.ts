import React from "react";

export interface SelectionPoint {
  day: Date;
  minutes: number;
}

export interface DragSelectionState {
  dragSelectionStart: SelectionPoint | null;
  setDragSelectionStart: (value: SelectionPoint | null) => void;
  dragSelectionEnd: SelectionPoint | null;
  setDragSelectionEnd: (value: SelectionPoint | null) => void;
  dragStartPosition: { x: number; y: number } | null;
  setDragStartPosition: (value: { x: number; y: number } | null) => void;
  isDraggingSelection: boolean;
  setIsDraggingSelection: (value: boolean) => void;
}

interface UseDragSelectionOptions {
  gridRef: React.RefObject<HTMLElement | null>;
  yToMinutes: (y: number) => number;
  getDayFromXPosition?: (clientX: number) => Date | null;
  snapMinutes?: number;
  dragThreshold?: number;
  onPreviewChange?: (columnPreview: number | null) => void;
  state: DragSelectionState;
  onComplete: (
    start: SelectionPoint,
    end: SelectionPoint,
    wasDrag: boolean
  ) => void;
}

/**
  * Shared drag-selection logic for calendar grids (week/day views).
  * Handles start/move/end, snapping, and normalization of start/end times.
  */
export function useDragSelection({
  gridRef,
  yToMinutes,
  getDayFromXPosition,
  snapMinutes = 15,
  dragThreshold = 3,
  onPreviewChange,
  state,
  onComplete,
}: UseDragSelectionOptions) {
  const activeRef = React.useRef(false);
  const {
    dragSelectionStart,
    setDragSelectionStart,
    dragSelectionEnd,
    setDragSelectionEnd,
    dragStartPosition,
    setDragStartPosition,
    isDraggingSelection,
    setIsDraggingSelection,
  } = state;

  const resetSelection = React.useCallback(() => {
    activeRef.current = false;
    setDragStartPosition(null);
    setDragSelectionStart(null);
    setDragSelectionEnd(null);
    setIsDraggingSelection(false);
    onPreviewChange?.(null);
  }, [
    setDragStartPosition,
    setDragSelectionStart,
    setDragSelectionEnd,
    setIsDraggingSelection,
    onPreviewChange,
  ]);

  const startSelection = React.useCallback(
    (
      e: React.MouseEvent,
      day: Date,
      startMinutes: number,
      previewIndex?: number
    ) => {
      // Don't start drag if clicking on an event
      if ((e.target as HTMLElement).closest("[data-event-card]")) {
        return;
      }

      activeRef.current = true;
      setDragStartPosition({ x: e.clientX, y: e.clientY });
      setDragSelectionStart({ day, minutes: startMinutes });
      setDragSelectionEnd({ day, minutes: startMinutes + snapMinutes });
      onPreviewChange?.(previewIndex ?? null);
    },
    [
      setDragStartPosition,
      setDragSelectionStart,
      setDragSelectionEnd,
      snapMinutes,
      onPreviewChange,
    ]
  );

  const handleMove = React.useCallback(
    (e: MouseEvent) => {
      if (!activeRef.current) return;
      if (!dragStartPosition || !dragSelectionStart) return;

      // Check if we've moved beyond threshold
      const deltaX = Math.abs(e.clientX - dragStartPosition.x);
      const deltaY = Math.abs(e.clientY - dragStartPosition.y);

      if (
        !isDraggingSelection &&
        (deltaX > dragThreshold || deltaY > dragThreshold)
      ) {
        setIsDraggingSelection(true);
      }

      if (
        !isDraggingSelection &&
        deltaX <= dragThreshold &&
        deltaY <= dragThreshold
      ) {
        return;
      }

      // Determine day column
      const day =
        getDayFromXPosition?.(e.clientX) ?? dragSelectionStart.day ?? null;
      if (!day) return;

      // Calculate minutes from Y position relative to the grid
      const gridEl = gridRef.current;
      if (!gridEl) return;

      const gridRect = gridEl.getBoundingClientRect();
      const y = e.clientY - gridRect.top;
      const minutes = yToMinutes(y);

      // Update end position (already snapped in yToMinutes, add snapMinutes for the end)
      setDragSelectionEnd({ day, minutes: minutes + snapMinutes });
    },
    [
      dragStartPosition,
      dragSelectionStart,
      isDraggingSelection,
      dragThreshold,
      getDayFromXPosition,
      gridRef,
      yToMinutes,
      snapMinutes,
      setDragSelectionEnd,
      setIsDraggingSelection,
    ]
  );

  const handleEnd = React.useCallback(
    (_e: MouseEvent) => {
      if (!dragSelectionStart) {
        resetSelection();
        return;
      }

      activeRef.current = false;
      const wasDragging = isDraggingSelection;
      setIsDraggingSelection(false);
      setDragStartPosition(null);

      const endPoint =
        dragSelectionEnd ?? {
          day: dragSelectionStart.day,
          minutes: dragSelectionStart.minutes + snapMinutes,
        };

      const normalizeRange = (
        start: SelectionPoint,
        end: SelectionPoint
      ): { start: SelectionPoint; end: SelectionPoint } => {
        const startTime = start.day.getTime() + start.minutes * 60000;
        const endTime = end.day.getTime() + end.minutes * 60000;
        if (endTime < startTime) {
          const adjustedStartMinutes = Math.max(0, end.minutes - snapMinutes);
          return {
            start: { day: end.day, minutes: adjustedStartMinutes },
            end: { day: start.day, minutes: start.minutes + snapMinutes },
          };
        }
        return { start, end };
      };

      const { start, end } = normalizeRange(dragSelectionStart, endPoint);

      onComplete(start, end, wasDragging);
      setDragSelectionStart(null);
      setDragSelectionEnd(null);
      onPreviewChange?.(null);
    },
    [
      dragSelectionStart,
      dragSelectionEnd,
      isDraggingSelection,
      snapMinutes,
      onComplete,
      resetSelection,
      setDragSelectionStart,
      setDragSelectionEnd,
      setDragStartPosition,
      setIsDraggingSelection,
      onPreviewChange,
    ]
  );

  // Attach document listeners while a drag is active
  React.useEffect(() => {
    if (dragStartPosition) {
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleEnd);
      return () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleEnd);
      };
    }
  }, [dragStartPosition, handleMove, handleEnd]);

  return {
    startSelection,
    dragSelectionStart,
    dragSelectionEnd,
    isDraggingSelection,
    resetSelection,
  };
}

export default useDragSelection;

