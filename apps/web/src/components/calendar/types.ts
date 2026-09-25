export interface CalendarEvent {
  id: string;
  start: Date;
  end?: Date;
  title: string;
  description?: string;
  label?: string | null;
  confirmed?: boolean;
  importance?: number | null;
  metadata?: Record<string, any>;
}

export interface CalendarRef {
  openEventModal: (date: Date) => void;
  openEventDetailsModal: (event: CalendarEvent) => void;
}

