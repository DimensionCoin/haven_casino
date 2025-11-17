// lib/plinko/objects.ts
import {
  HEIGHT,
  NUM_SINKS,
  WIDTH,
  obstacleRadius,
  sinkWidth,
} from "./constants";
import { pad } from "./padding";
import { PLINKO_MULTIPLIERS } from "./config"; // 👈 use shared config

export interface Obstacle {
  x: number;
  y: number;
  radius: number;
}

export interface Sink {
  x: number;
  y: number;
  width: number;
  height: number;
  multiplier?: number;
}

// ❌ REMOVE the old local MULTIPLIERS map
// const MULTIPLIERS: { [key: number]: number } = { ... };

export const createObstacles = (): Obstacle[] => {
  const obstacles: Obstacle[] = [];
  const rows = 18;

  for (let row = 2; row < rows; row++) {
    const numObstacles = row + 1;
    const y = 0 + row * 35;
    const spacing = 36;
    for (let col = 0; col < numObstacles; col++) {
      const x = WIDTH / 2 - spacing * (row / 2 - col);
      obstacles.push({ x: pad(x), y: pad(y), radius: obstacleRadius });
    }
  }

  return obstacles;
};

export const createSinks = (): Sink[] => {
  const sinks: Sink[] = [];
  const SPACING = obstacleRadius * 2;

  for (let i = 0; i < NUM_SINKS; i++) {
    const x =
      WIDTH / 2 + sinkWidth * (i - Math.floor(NUM_SINKS / 2)) - SPACING * 1.5;
    const y = HEIGHT - 170;
    const width = sinkWidth;
    const height = width;

    // i is 0..16, PLINKO_MULTIPLIERS is defined for 0..16
    const multiplier = PLINKO_MULTIPLIERS[i] ?? 0;

    sinks.push({ x, y, width, height, multiplier });
  }

  return sinks;
};
