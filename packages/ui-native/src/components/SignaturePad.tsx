import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanResponder, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";

import { color, radius, space } from "../tokens";
import { Button } from "./Button";
import { Text } from "./Text";

export type SignaturePoint = [number, number];

/** A drawn signature: the pad's size and the strokes, as numbers only. */
export interface Signature {
  width: number;
  height: number;
  strokes: SignaturePoint[][];
}

export interface SignaturePadProps {
  /** Called with the signature after every stroke, or null once cleared. */
  onChange: (signature: Signature | null) => void;
  /**
   * Told when a finger goes down and comes up, so a parent ScrollView can stop
   * scrolling while someone signs.
   */
  onDrawingChange?: (drawing: boolean) => void;
  height?: number;
  /** What the pad is for, read out: "Signature for Chemical handling policy". */
  label: string;
}

const MAX_STROKES = 64;
const MAX_POINTS = 2000;
/** Points across every stroke, as the server allows. */
const MAX_TOTAL_POINTS = 10_000;
/** Points closer than this to the last one are dropped: smoother, and smaller to send. */
const MIN_STEP = 2;

const round = (n: number) => Math.round(n * 10) / 10;

const INK = { stroke: color.ink, strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;

function toPath(stroke: readonly SignaturePoint[]): string {
  if (stroke.length === 1) {
    const [x, y] = stroke[0]!;
    // A tap is a dot: a zero-length line with round caps.
    return `M${x} ${y}L${x + 0.1} ${y}`;
  }
  return stroke.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("");
}

/**
 * A box to sign in with a finger. It records strokes as points, never as an
 * image, so what leaves the phone is numbers the server draws for itself.
 */
export function SignaturePad({ onChange, onDrawingChange, height = 170, label }: SignaturePadProps) {
  const [width, setWidth] = useState(0);
  // Finished strokes change only when a finger lifts or the pad is cleared;
  // the stroke being drawn is its own state, so a move redraws that one line
  // and not the whole signature.
  const [strokes, setStrokes] = useState<SignaturePoint[][]>([]);
  const [live, setLive] = useState<SignaturePoint[] | null>(null);
  // The stroke being drawn lives in a ref (every move event) and is copied to
  // state as it grows, so the drawing follows the finger.
  const current = useRef<SignaturePoint[] | null>(null);
  const done = useRef<SignaturePoint[][]>([]);
  const points = useRef(0);
  // The responder is made once, so it reads the latest size and callbacks here.
  const size = useRef({ width: 0, height });
  const handlers = useRef({ onChange, onDrawingChange });
  useLayoutEffect(() => {
    size.current = { width, height };
    handlers.current = { onChange, onDrawingChange };
  });

  // Clamped to the size the signature reports (whole points), so no point
  // lands a fraction outside the pad the server checks it against.
  const clamp = (x: number, y: number): SignaturePoint => [
    round(Math.min(Math.max(x, 0), Math.round(size.current.width))),
    round(Math.min(Math.max(y, 0), Math.round(size.current.height))),
  ];

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Once signing, keep the gesture: a scroll view must not steal it.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          if (done.current.length >= MAX_STROKES || points.current >= MAX_TOTAL_POINTS) return;
          handlers.current.onDrawingChange?.(true);
          current.current = [clamp(e.nativeEvent.locationX, e.nativeEvent.locationY)];
          setLive(current.current);
        },
        onPanResponderMove: (e) => {
          const stroke = current.current;
          if (!stroke || stroke.length >= MAX_POINTS || points.current + stroke.length >= MAX_TOTAL_POINTS) return;
          const p = clamp(e.nativeEvent.locationX, e.nativeEvent.locationY);
          const last = stroke[stroke.length - 1]!;
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) return;
          stroke.push(p);
          setLive([...stroke]);
        },
        onPanResponderRelease: () => finish(),
        onPanResponderTerminate: () => finish(),
      }),
    // The responder reads everything through refs, so it is made once.
    [],
  );

  function finish() {
    handlers.current.onDrawingChange?.(false);
    const stroke = current.current;
    current.current = null;
    setLive(null);
    if (!stroke) return;
    done.current = [...done.current, stroke];
    points.current += stroke.length;
    setStrokes(done.current);
    const { width: w, height: h } = size.current;
    handlers.current.onChange({ width: Math.round(w), height: Math.round(h), strokes: done.current });
  }

  function clear() {
    done.current = [];
    current.current = null;
    points.current = 0;
    setStrokes([]);
    setLive(null);
    onChange(null);
  }

  const empty = strokes.length === 0 && !live;
  // Built again only when a stroke is finished: the same elements otherwise,
  // so React skips them while the live stroke follows the finger.
  const finished = useMemo(
    () => strokes.map((s, i) => <Path key={i} d={toPath(s)} {...INK} />),
    [strokes],
  );

  return (
    <View style={{ gap: space[2] }}>
      <View
        accessible
        accessibilityLabel={`${label}. Draw your signature with one finger.`}
        accessibilityHint={empty ? "Nothing drawn yet" : "Signature drawn"}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{
          height,
          borderRadius: radius.lg,
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: color.lineStrong,
          backgroundColor: color.surface,
          overflow: "hidden",
        }}
        {...responder.panHandlers}
      >
        {empty ? (
          <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
            <Text variant="bodyStrong" color="ink3">
              Sign here
            </Text>
          </View>
        ) : null}
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: space[5], right: space[5], bottom: space[8], flexDirection: "row", alignItems: "flex-end", gap: space[2] }}
        >
          <Text variant="bodyStrong" color="ink3">
            ✕
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: color.lineStrong, marginBottom: 5 }} />
        </View>
        {width > 0 ? (
          <Svg width={width} height={height} pointerEvents="none">
            {finished}
            {live ? <Path key="live" d={toPath(live)} {...INK} /> : null}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button label="Clear" variant="secondary" size="md" disabled={empty} onPress={clear} />
      </View>
    </View>
  );
}
