import { RoomConfig } from "@/types/calendar";

export function getAvailableRoomsForEventType(
  eventType: string,
  rooms: Array<{ name: string; labelConfig?: RoomConfig }>
): Array<{ name: string; labelConfig?: RoomConfig }> {
  // UI-only: return all rooms
  return rooms;
}

export function validateRoomEventTypeCompatibility(
  roomName: string,
  eventType: string,
  rooms: Array<{ name: string; labelConfig?: RoomConfig }>
): { isValid: boolean; message?: string } {
  // UI-only: always valid
  return { isValid: true };
}

