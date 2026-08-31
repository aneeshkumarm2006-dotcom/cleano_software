# Calendar Job Management - Enhanced Event Handling

## Overview

The calendar now supports full drag-and-drop functionality for managing job schedules. Users can move and resize job events directly in the calendar, with changes automatically saved to the database.

## Features Implemented

### 1. **Drag-and-Drop Job Rescheduling**

- Click and drag any job event to move it to a new date/time
- Works across all calendar views (Month, Week, Day)
- Automatically updates job start and end times in the database
- Visual feedback with toast notifications

### 2. **Job Duration Resizing**

- Grab the top or bottom edge of a job event to resize
- Available in Week and Day views
- Updates job start or end time based on which edge is dragged
- Snaps to 15-minute intervals for precision

### 3. **Visual Confirmation**

- All jobs display with solid (confirmed) styling
- Color-coded by job status:
  - **Slate** (#94A3B8) - CREATED
  - **Blue** (#3B82F6) - SCHEDULED
  - **Amber** (#F59E0B) - IN_PROGRESS
  - **Green** (#10B981) - COMPLETED
  - **Dark Green** (#059669) - PAID
  - **Red** (#EF4444) - CANCELLED

### 4. **Real-time Updates**

- Toast notifications show update progress
- Loading state while saving
- Success confirmation when complete
- Error handling with revert on failure

## User Experience

### Moving a Job:

1. **Click and hold** on any job event
2. **Drag** to the desired date/time slot
3. **Release** to save
4. See toast notification: "Job Updated - Job date and time updated successfully"

### Resizing a Job:

1. **Hover** over the top or bottom edge of a job (Week/Day view only)
2. **Click and drag** the resize handle
3. **Release** to save
4. See toast notification: "Job Updated - Job duration updated successfully"

### Visual Feedback:

- **During drag**: Event appears slightly transparent (70% opacity)
- **Loading**: Blue toast with spinner
- **Success**: Green toast with checkmark
- **Error**: Red toast with X icon (job reverts to original time)

## Technical Implementation

### Files Created/Modified:

**New Files:**

1. `src/app/(app)/actions/updateJobDates.ts` - Server action for database updates
2. `src/components/ui/Toast.tsx` - Toast notification component

**Modified Files:**

1. `src/components/calendar/CalendarContext.tsx` - Event move/resize handlers
2. `src/components/calendar/event-styles.ts` - Job styling (all confirmed)
3. `src/components/calendar/WeekView.tsx` - Enable job resizing
4. `src/components/calendar/DayView.tsx` - Enable job resizing

### Server Action: `updateJobDates`

```typescript
updateJobDates(jobId: string, startTime: Date, endTime?: Date)
```

**Features:**

- Validates user permissions (admin or job owner)
- Updates `startTime`, `endTime`, and `jobDate` fields
- Revalidates calendar and jobs pages
- Returns success/error status

**Permissions:**

- Admins/Owners: Can update any job
- Employees: Can only update their own assigned jobs

### Event Handling Flow:

```
User drags job event
    ↓
Calendar updates visual position (local state)
    ↓
User releases mouse
    ↓
finalizeEventMove() called
    ↓
Check if job event (metadata.jobId exists)
    ↓
Show loading toast
    ↓
Call updateJobDates() server action
    ↓
Server validates & updates database
    ↓
On success:
  - Update local state
  - Show success toast
  - Keep visual change
    ↓
On error:
  - Revert local state
  - Show error toast
  - Job returns to original position
```

## API Reference

### Toast Notifications

**Types:**

- `"loading"` - Blue background, spinning icon
- `"success"` - Green background, checkmark icon
- `"error"` - Red background, X icon

**Usage:**

```typescript
showNotification(
  "success",
  "Job Updated",
  "Job date and time updated successfully"
);
```

### Calendar Event Metadata

Job events include the following metadata:

```typescript
{
  jobId: string; // Database job ID
  status: JobStatus; // Job status for color coding
  location: string; // Job location
  price: number; // Job price
  employeePay: number; // Employee payment
  // ... other job fields
}
```

## Configuration

### Enable/Disable Job Dragging

To disable dragging for specific jobs, modify the `handleEventMouseDown` function to check additional conditions:

```typescript
// In WeekView.tsx or DayView.tsx
const handleEventMouseDown = useCallback((e, event, date) => {
  // Add condition to prevent dragging
  if (event.metadata?.jobId && event.metadata?.status === "COMPLETED") {
    return; // Don't allow dragging completed jobs
  }
  // ... rest of handler
}, []);
```

### Enable/Disable Job Resizing

To disable resizing for specific jobs:

```typescript
// In WeekView.tsx or DayView.tsx
const isEventResizable = useCallback((event: CalendarEvent): boolean => {
  if (event.metadata?.isTdoAppointment) return false;

  // Disable resize for completed jobs
  if (event.metadata?.jobId && event.metadata?.status === "COMPLETED") {
    return false;
  }

  if (event.metadata?.jobId) return true;
  return !event.metadata?.selectedEventType;
}, []);
```

## Error Handling

### Common Errors:

1. **Permission Denied**

   - User tries to move a job they don't own
   - Shows error toast: "Update Failed - Permission denied"
   - Job reverts to original position

2. **Job Not Found**

   - Job was deleted by another user
   - Shows error toast: "Update Failed - Job not found"
   - Job reverts to original position

3. **Network Error**
   - Server unreachable
   - Shows error toast: "Update Failed - An error occurred while updating the job"
   - Job reverts to original position

### Debugging

Enable console logging:

```typescript
// In CalendarContext.tsx
console.log("Moving job:", movingEvent.metadata?.jobId);
console.log("New time:", movingEvent.start, movingEvent.end);
```

## Performance Optimizations

1. **Optimistic Updates**: Visual changes happen immediately
2. **Debouncing**: Multiple rapid moves only trigger one save
3. **Local State**: Calendar doesn't reload entire page on update
4. **Revalidation**: Only calendar and jobs pages are revalidated

## Future Enhancements

### Potential Improvements:

1. **Batch Updates**: Move multiple jobs at once
2. **Undo/Redo**: Allow reverting recent changes
3. **Conflict Detection**: Warn about scheduling conflicts
4. **Copy/Duplicate**: Duplicate jobs by alt-dragging
5. **Recurring Jobs**: Support for repeating events
6. **Smart Scheduling**: AI-powered optimal time suggestions

## Testing Checklist

- [x] Jobs can be dragged in Month view
- [x] Jobs can be dragged in Week view
- [x] Jobs can be dragged in Day view
- [x] Jobs can be resized in Week view
- [x] Jobs can be resized in Day view
- [x] Database updates correctly
- [x] Toast notifications appear
- [x] Error handling works (try moving another user's job)
- [x] Jobs revert on error
- [x] All job statuses display with solid styling
- [x] Changes persist after page refresh
- [x] Permissions are enforced

## Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## Support

For issues or questions:

1. Check console for error messages
2. Verify user has permission to edit the job
3. Ensure database connection is active
4. Check that job still exists in database
