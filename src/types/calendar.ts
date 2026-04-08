export interface ScheduleBlocksConfig {
  [key: string]: any;
}

export interface EventTypesConfig {
  [key: string]: {
    name?: string;
    color?: string;
    durationMins?: number;
    allowedTimeSlots?: Array<{ startTime: string; endTime: string }>;
    allowedDaysOfWeek?: number[];
    defaultTitle?: string;
    [key: string]: any;
  };
}

export interface RoomConfig {
  name: string;
  allowedEventTypes?: string[];
  [key: string]: any;
}

