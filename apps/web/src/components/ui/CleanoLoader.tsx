"use client";

// CleanoLoader — branded water-drop loader (ported from the Cleano design handoff).
// A filling water-drop, gently bobbing, with a soft surface ripple.
// Used as the loading state across the app.
//
//   <CleanoLoader />                                  // inline, default copy
//   <CleanoLoader fullscreen />                       // fills the viewport (cream backdrop)
//   <CleanoLoader size={40} label="" />               // compact, no label
//   <CleanoLoader onDark />                            // on a dark panel
//   <CleanoLoader variant="ripple" />                 // water-ripple alt
//   <CleanoLoader messages={["Tallying revenue…", "Counting jobs…"]} />  // rotating copy

import { useEffect, useMemo, useState } from "react";

const DROP = "M12 3c-1 2-6 7-6 11a6 6 0 0 0 12 0c0-4-5-9-6-11z";
const WAVE =
  "M-12 4 Q-9 1 -6 4 T0 4 T6 4 T12 4 T18 4 T24 4 T30 4 T36 4 V30 H-12 Z";

export interface CleanoLoaderProps {
  size?: number;
  label?: string;
  messages?: string[] | null;
  fullscreen?: boolean;
  /** Center within the full height of the parent (route loading states). */
  fill?: boolean;
  variant?: "fill" | "ripple";
  onDark?: boolean;
  style?: React.CSSProperties;
}

export default function CleanoLoader({
  size = 64,
  label = "Crunching the numbers…",
  messages = null,
  fullscreen = false,
  fill = false,
  variant = "fill",
  onDark = false,
  style,
}: CleanoLoaderProps) {
  const clipId = useMemo(() => "clo" + Math.random().toString(36).slice(2, 8), []);
  const [idx, setIdx] = useState(0);
  const rotating = Array.isArray(messages) && messages.length > 1;

  useEffect(() => {
    if (!rotating || !messages) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % messages.length), 2200);
    return () => clearInterval(t);
  }, [rotating, messages]);

  const text = rotating && messages ? messages[idx] : label;

  let visual: React.ReactNode;
  if (variant === "ripple") {
    visual = (
      <div className="clo-ripple" style={{ width: size * 1.9, height: size * 1.9 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="clo-ripple-ring" style={{ animationDelay: `${i * 0.55}s` }} />
        ))}
        <svg className="clo-drop" width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" aria-hidden="true">
          <path className="clo-wave" d={DROP} style={{ animation: "none", fillOpacity: 0.85 }} />
        </svg>
      </div>
    );
  } else {
    visual = (
      <div className="clo-drop-wrap">
        <svg className="clo-drop" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Loading">
          <defs>
            <clipPath id={clipId}>
              <path d={DROP} />
            </clipPath>
          </defs>
          <path className="clo-drop-bg" d={DROP} />
          <g clipPath={`url(#${clipId})`}>
            <g className="clo-water">
              <path className="clo-wave" d={WAVE} />
            </g>
          </g>
          <path className="clo-drop-edge" d={DROP} />
          <ellipse className="clo-gloss" cx="9.3" cy="9" rx="1.3" ry="2.1" transform="rotate(-22 9.3 9)" />
        </svg>
      </div>
    );
  }

  const body = (
    <div className={`clo-loader ${onDark ? "on-dark" : ""}`} style={style} role="status" aria-live="polite">
      {visual}
      {text ? (
        <div className="clo-label">
          <span className="clo-label-text" key={text}>
            {text}
          </span>
        </div>
      ) : null}
    </div>
  );

  if (fullscreen) return <div className="clo-fullscreen">{body}</div>;
  if (fill) return <div className="clo-fill">{body}</div>;
  return body;
}
