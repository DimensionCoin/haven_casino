// lib/plinko/BallManager.ts
import {
  HEIGHT,
  WIDTH,
  ballRadius,
  obstacleRadius,
} from "./constants";
import { Obstacle, Sink, createObstacles, createSinks } from "./objects";
import { pad, unpad } from "./padding";
import { Ball } from "./ball";
import { PLINKO_MULTIPLIERS } from "./config"; // 👈 import config

export class BallManager {
  private balls: Ball[];
  private canvasRef: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private obstacles: Obstacle[];
  private sinks: Sink[];
  private requestId?: number;
  private onFinish?: (index: number, startX?: number) => void;

  constructor(
    canvasRef: HTMLCanvasElement,
    onFinish?: (index: number, startX?: number) => void
  ) {
    this.balls = [];
    this.canvasRef = canvasRef;
    this.ctx = this.canvasRef.getContext("2d")!;
    this.obstacles = createObstacles();
    this.sinks = createSinks();
    this.update();
    this.onFinish = onFinish;
  }

  addBall(startX?: number) {
    const newBall = new Ball(
      startX || pad(WIDTH / 2 + 13),
      pad(50),
      ballRadius,
      "green",
      this.ctx,
      this.obstacles,
      this.sinks,
      (index) => {
        this.balls = this.balls.filter((ball) => ball !== newBall);
        this.onFinish?.(index, startX);
      }
    );
    this.balls.push(newBall);
  }

  drawObstacles() {
    this.ctx.fillStyle = "white";
    this.obstacles.forEach((obstacle) => {
      this.ctx.beginPath();
      this.ctx.arc(
        unpad(obstacle.x),
        unpad(obstacle.y),
        obstacle.radius,
        0,
        Math.PI * 2
      );
      this.ctx.fill();
      this.ctx.closePath();
    });
  }

  getColor(index: number) {
    if (index < 3 || index > this.sinks.length - 3) {
      return { background: "#ff003f", color: "white" };
    }
    if (index < 6 || index > this.sinks.length - 6) {
      return { background: "#ff7f00", color: "white" };
    }
    if (index < 9 || index > this.sinks.length - 9) {
      return { background: "#ffbf00", color: "black" };
    }
    if (index < 12 || index > this.sinks.length - 12) {
      return { background: "#ffff00", color: "black" };
    }
    if (index < 15 || index > this.sinks.length - 15) {
      return { background: "#bfff00", color: "black" };
    }
    return { background: "#7fff00", color: "black" };
  }

  drawSinks() {
    const SPACING = obstacleRadius * 2;
    const WIDTH_SCALE = 1.2; // 👈 make this bigger/smaller to tune width

    this.ctx.save();

    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.font =
      "bold 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

    for (let i = 0; i < this.sinks.length; i++) {
      const sink = this.sinks[i];

      const multiplier =
        typeof PLINKO_MULTIPLIERS[i] === "number"
          ? PLINKO_MULTIPLIERS[i]
          : sink.multiplier ?? 0;

      const { background, color } = this.getColor(i);

      // Base geometry from sink
      const baseX = sink.x;
      const baseY = sink.y - sink.height / 2;
      const baseW = sink.width - SPACING + 2;
      const h = sink.height;

      // 🔥 Scale width, keep center fixed
      const w = baseW * WIDTH_SCALE;
      const x = baseX - (w - baseW) / 2;
      const y = baseY;

      const radius = Math.min(h / 2, 10);

      // Puffy rounded rect
      this.ctx.beginPath();
      this.ctx.moveTo(x + radius, y);
      this.ctx.lineTo(x + w - radius, y);
      this.ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      this.ctx.lineTo(x + w, y + h - radius);
      this.ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      this.ctx.lineTo(x + radius, y + h);
      this.ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      this.ctx.lineTo(x, y + radius);
      this.ctx.quadraticCurveTo(x, y, x + radius, y);
      this.ctx.closePath();

      this.ctx.fillStyle = background;
      this.ctx.strokeStyle = "rgba(15,23,42,0.9)";
      this.ctx.lineWidth = 1.5;
      this.ctx.fill();
      this.ctx.stroke();

      // Centered text
      this.ctx.fillStyle = color;
      this.ctx.fillText(`${multiplier}x`, x + w / 2, y + h / 2);
    }

    this.ctx.restore();
  }


  draw() {
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
    this.drawObstacles();
    this.drawSinks();
    this.balls.forEach((ball) => {
      ball.draw();
      ball.update();
    });
  }

  update() {
    this.draw();
    this.requestId = requestAnimationFrame(this.update.bind(this));
  }

  stop() {
    if (this.requestId) {
      cancelAnimationFrame(this.requestId);
    }
  }
}
