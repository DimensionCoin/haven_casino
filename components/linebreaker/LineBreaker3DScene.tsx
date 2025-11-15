// components/linebreaker/LineBreaker3DScene.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";

type LineBreakerSceneProps = {
  rolling: boolean;
  finalRoll?: number; // 0–100 (can be decimal)
  target?: number;
  direction?: "over" | "under";
  isWin?: boolean;
  // NEW: amounts to show inside the wheel
  profitAmount?: number; // net profit (win)
  betAmount?: number; // stake (for loss)
};

const FULL_TURN = Math.PI * 2;

function clampRoll(v: number) {
  return Math.max(0, Math.min(100, v));
}

function rollToAngle(roll: number) {
  const norm = clampRoll(roll) / 100;
  // negative so rotation is clockwise
  return -norm * FULL_TURN;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function formatAmount(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export function LineBreaker3DScene({
  rolling,
  finalRoll,
  target = 50,
  direction = "over",
  isWin = false,
  profitAmount,
  betAmount,
}: LineBreakerSceneProps) {
  // internal animation state (refs so we can mutate per frame)
  const angleRef = useRef(0); // ball angle in radians
  const phaseRef = useRef<"idle" | "freeSpin" | "spinToResult" | "result">(
    "idle"
  );
  const freeSpinSpeedRef = useRef(10); // rad/s

  const startAngleRef = useRef(0);
  const endAngleRef = useRef(0);
  const progressRef = useRef(0);
  const winningAngleRef = useRef<number | null>(null);

  const prevTimeRef = useRef<number | null>(null);

  // angle exposed to render
  const [angle, setAngle] = useState(0);
  // gate for revealing the answer
  const [hasResultStopped, setHasResultStopped] = useState(false);

  /* ----------------- react to "rolling" and "finalRoll" ----------------- */

  // When rolling with no finalRoll yet → free spinning
  useEffect(() => {
    if (rolling && finalRoll === undefined) {
      phaseRef.current = "freeSpin";
      freeSpinSpeedRef.current = 8 + Math.random() * 4; // 8–12 rad/s
      setHasResultStopped(false); // hide previous result
    }
  }, [rolling, finalRoll]);

  // When finalRoll appears and we stop rolling → spin toward result
  useEffect(() => {
    if (!rolling && finalRoll !== undefined) {
      const currentAngle = angleRef.current;
      const targetAngle = rollToAngle(finalRoll);

      const extraTurns = 3 * FULL_TURN; // extra laps for drama
      const endAngle = targetAngle - extraTurns;

      startAngleRef.current = currentAngle;
      endAngleRef.current = endAngle;
      progressRef.current = 0;
      winningAngleRef.current = targetAngle;
      phaseRef.current = "spinToResult";
      setHasResultStopped(false); // still spinning to result
    }
  }, [rolling, finalRoll]);

  /* ---------------------- animation loop (requestAnimationFrame) ---------------------- */

  useEffect(() => {
    let frameId: number;

    const animate = (time: number) => {
      if (prevTimeRef.current === null) {
        prevTimeRef.current = time;
      }
      const dt = (time - prevTimeRef.current) / 1000; // seconds
      prevTimeRef.current = time;

      const phase = phaseRef.current;

      if (phase === "freeSpin") {
        // constant speed circular motion
        angleRef.current -= dt * freeSpinSpeedRef.current;
      } else if (phase === "spinToResult") {
        const duration = 2.4; // seconds to slow and stop
        progressRef.current = Math.min(1, progressRef.current + dt / duration);
        const p = easeOutCubic(progressRef.current);

        const start = startAngleRef.current;
        const end = endAngleRef.current;

        angleRef.current = start + (end - start) * p;

        if (progressRef.current >= 1) {
          phaseRef.current = "result";
          if (winningAngleRef.current !== null) {
            angleRef.current = winningAngleRef.current;
          }
          // 🔥 only now do we reveal the rolled number & highlight
          setHasResultStopped(true);
        }
      }

      // push current angle into React state for rendering
      setAngle(angleRef.current);

      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, []);

  /* ---------------------- geometry + styling helpers ---------------------- */

  const BALL_RADIUS = 34; // track radius
  const NUMBER_RADIUS_OUTER = 45; // outer ring
  const NUMBER_RADIUS_INNER = 40; // inner ring (staggered)
  const OUTER_RADIUS = 55;

  const numbers = Array.from({ length: 100 }, (_, i) => i + 1);

  const winColor = "#22c55e";
  const loseColor = "#f97373";
  const feltColor = "#041f1a";

  const directionColor = direction === "over" ? "#0ea5e9" : "#f97316"; // cyan vs amber

  // ball coordinates in SVG space (centered at 0,0)
  const ballX = Math.cos(angle) * BALL_RADIUS;
  const ballY = Math.sin(angle) * BALL_RADIUS;

  const clampedTarget = clampRoll(target);
  const clampedResult = finalRoll !== undefined ? clampRoll(finalRoll) : null;
  const winningNumber =
    clampedResult !== null ? Math.round(clampedResult) : null;

  /* ---------------------- render ---------------------- */

  return (
    <div className="w-full h-full flex items-center justify-center bg-black/80 border border-zinc-800/80 rounded-3xl">
      <div className="aspect-square w-[95%] max-w-[460px]">
        <svg
          viewBox="-60 -60 120 120"
          width="100%"
          height="100%"
          style={{ display: "block" }}
        >
          {/* background */}
          <defs>
            <radialGradient id="tableFeltGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#022c22" />
              <stop offset="100%" stopColor={feltColor} />
            </radialGradient>
            <radialGradient id="rimGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#facc15" />
              <stop offset="80%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#78350f" />
            </radialGradient>
          </defs>

          {/* table base */}
          <circle cx={0} cy={0} r={OUTER_RADIUS} fill="#020617" />
          {/* felt */}
          <circle
            cx={0}
            cy={0}
            r={OUTER_RADIUS - 4}
            fill="url(#tableFeltGrad)"
          />
          {/* golden rim */}
          <circle
            cx={0}
            cy={0}
            r={OUTER_RADIUS - 2}
            fill="none"
            stroke="url(#rimGrad)"
            strokeWidth={3}
          />

          {/* inner track ring */}
          <circle
            cx={0}
            cy={0}
            r={BALL_RADIUS}
            fill="none"
            stroke="#0b1120"
            strokeWidth={4}
          />

          {/* numbers around the circle (staggered inner/outer ring) */}
          {numbers.map((n) => {
            const fraction = n / 100;
            const theta = -fraction * FULL_TURN;

            // stagger: odd numbers outer, even numbers inner
            const radius =
              n % 2 === 0 ? NUMBER_RADIUS_INNER : NUMBER_RADIUS_OUTER;

            const x = Math.cos(theta) * radius;
            const y = Math.sin(theta) * radius;

            const isWinningPocket =
              hasResultStopped && winningNumber !== null && winningNumber === n;
            const isUnder = n <= clampedTarget;

            const baseTextColor = isUnder ? "#e5e7eb" : "#9ca3af";
            const textColor = isWinningPocket ? "#fefce8" : baseTextColor;

            const deg = (theta * 180) / Math.PI + 90;

            const baseFont = 2.1;
            const fontSize = isWinningPocket ? baseFont * 1.7 : baseFont;

            return (
              <g key={n} transform={`translate(${x}, ${y}) rotate(${deg})`}>
                <text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={fontSize}
                  fill={textColor}
                  style={{ fontFamily: "system-ui, sans-serif" }}
                >
                  {n}
                </text>
              </g>
            );
          })}

          {/* ball */}
          <circle
            cx={ballX}
            cy={ballY}
            r={2.2}
            fill="#f9fafb"
            stroke="#e5e7eb"
            strokeWidth={0.6}
          />

          {/* center medallion */}
          <circle
            cx={0}
            cy={0}
            r={17}
            fill="#020617"
            stroke={hasResultStopped && isWin ? winColor : "#1f2937"}
            strokeWidth={2}
          />

          {/* center result number – ONLY after ball has stopped */}
          {hasResultStopped && clampedResult !== null && (
            <text
              x={0}
              y={-1.5}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fill={isWin ? "#bbf7d0" : "#fef9c3"}
              style={{
                fontFamily: "system-ui, sans-serif",
                fontWeight: 700,
              }}
            >
              {clampedResult.toFixed(0)}
            </text>
          )}

          {/* WIN / LOSS AMOUNT – small text inside medallion */}
          {hasResultStopped && clampedResult !== null && (
            <>
              {isWin && profitAmount !== undefined && profitAmount !== 0 && (
                <text
                  x={0}
                  y={4.5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={3.3}
                  fill={winColor}
                  style={{
                    fontFamily: "system-ui, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {`+${formatAmount(profitAmount)} chips`}
                </text>
              )}

              {!isWin && betAmount !== undefined && betAmount > 0 && (
                <text
                  x={0}
                  y={4.5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={3.3}
                  fill={loseColor}
                  style={{
                    fontFamily: "system-ui, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {`-${formatAmount(betAmount)} chips`}
                </text>
              )}
            </>
          )}

          {/* OVER / UNDER label */}
          <text
            x={0}
            y={9}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={3.4}
            fill={directionColor}
            style={{
              fontFamily: "system-ui, sans-serif",
              letterSpacing: "0.12em",
            }}
          >
            {direction.toUpperCase()}
          </text>

          {/* WIN / LOSE chip – ONLY after ball has stopped */}
          {hasResultStopped && clampedResult !== null && (
            <g transform="translate(0, -19)">
              <circle cx={0} cy={0} r={5} fill={isWin ? winColor : loseColor} />
              <text
                x={0}
                y={0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={3.4}
                fill="#020617"
                style={{
                  fontFamily: "system-ui, sans-serif",
                  fontWeight: 700,
                }}
              >
                {isWin ? "WIN" : "LOSE"}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
