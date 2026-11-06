import type { Point, VisionFrame } from "./vision-types";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
] as const;

function drawable(point: Point | undefined): point is Point {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function drawLandmarkOverlay(context: CanvasRenderingContext2D, width: number, height: number, frame: VisionFrame) {
  const drawPoints = (points: Point[], color: string, radius: number) => {
    if (!points.length) return;
    context.fillStyle = color;
    for (const point of points) {
      if (!drawable(point)) continue;
      context.beginPath();
      context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
      context.fill();
    }
  };

  context.strokeStyle = "rgba(118, 236, 199, .78)";
  context.lineWidth = 2;
  for (const hand of frame.hands) {
    for (const [a, b] of HAND_CONNECTIONS) {
      const start = hand.landmarks[a], end = hand.landmarks[b];
      if (!drawable(start) || !drawable(end)) continue;
      context.beginPath();
      context.moveTo(start.x * width, start.y * height);
      context.lineTo(end.x * width, end.y * height);
      context.stroke();
    }
    drawPoints(hand.landmarks, "#b8ffe9", 3.2);
  }
  drawPoints(frame.face, "rgba(255, 217, 129, .9)", 2.6);
  drawPoints(frame.pose, "rgba(190, 220, 255, .9)", 3.2);
}
