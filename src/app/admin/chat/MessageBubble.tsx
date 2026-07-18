"use client";

import type { ChatMessageDTO } from "./types";
import { fmtTime } from "@/lib/time";

interface MessageBubbleProps {
  message: ChatMessageDTO;
  isMine: boolean;
}

function formatTime(iso: string) {
  return fmtTime(iso);
}

export default function MessageBubble({ message, isMine }: MessageBubbleProps) {
  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 ${
          isMine
            ? "bg-[#008C9C] text-white"
            : "bg-[#008C9C]/8 text-[#008C9C]"
        }`}>
        {!isMine && (
          <div className="text-[10px] font-[400] opacity-70 mb-0.5">
            {message.senderName}
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap break-words leading-snug">
          {message.body}
        </div>
        <div
          className={`text-[9px] mt-0.5 ${
            isMine ? "text-white/50 text-right" : "text-[#008C9C]/40"
          }`}>
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}
