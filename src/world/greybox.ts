// M1 greybox: one straight street with lines strung across it.
import { makeWorld, type Anchor, type Box, type SimWorld } from "../sim/world";

export function greybox(): SimWorld {
  const boxes: Box[] = [];
  const anchors: Anchor[] = [];
  // Street runs toward -z, 14 m wide, buildings both sides.
  for (let i = 0; i < 14; i++) {
    const z1 = -i * 24, z0 = z1 - 21;
    const hl = 16 + ((i * 7) % 5) * 2, hr = 15 + ((i * 5) % 6) * 2;
    boxes.push({ x0: -21, x1: -7, z0, z1, h: hl });
    boxes.push({ x0: 7, x1: 21, z0, z1, h: hr });
  }
  for (let i = 0; i < 15; i++) {
    const z = -14 - i * 21;
    anchors.push({ kind: "line", a: [-7, 25, z], b: [7, 25, z], sag: 1.5, look: "line" });
  }
  return makeWorld(boxes, {
    id: "greybox", name: "Greybox", idea: "hold, swing, release",
    guide: [[0, 0, 0], [0, 0, -320]],
    start: [0, 19, 6], startSpeed: 10, anchors, wind: [],
  });
}
