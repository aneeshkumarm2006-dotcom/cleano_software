import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

export interface ProgressRingProps {
  /** 0 to 1. Values past 1 draw a full ring (the job ran over). */
  progress: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor: string;
  /** What sits in the middle: the timer. */
  children?: ReactNode;
  /** Read out instead of the drawing: "1 hour 24 minutes of 3 hours". */
  accessibilityLabel?: string;
}

/** A ring that fills clockwise from the top, with content centred inside. */
export function ProgressRing({
  progress,
  size = 250,
  strokeWidth = 12,
  color,
  trackColor,
  children,
  accessibilityLabel,
}: ProgressRingProps) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "progressbar" : undefined}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          // Start at twelve o'clock, not three.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}
