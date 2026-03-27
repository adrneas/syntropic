import type { TerrainGridConfig, TerrainPoint } from '../../core/types/terrain';
import { getTerrainWorldSize, pointInPolygon } from '../../core/utils/terrain';

export interface ContourSegment {
  level: number;
  points: [number, number, number][];
}

interface MarchingCell {
  x: number;
  y: number;
  values: [number, number, number, number]; // TL, TR, BR, BL
}

/**
 * Generate contour line segments from an elevation grid using marching squares.
 * Returns grouped polylines for each contour level.
 */
export function generateContourLines(
  elevationGrid: Float32Array,
  config: TerrainGridConfig,
  polygon: TerrainPoint[],
  targetLineCount = 8,
): ContourSegment[] {
  if (elevationGrid.length === 0 || polygon.length < 3) {
    return [];
  }

  const { gridWidth, gridHeight } = config;

  // Find elevation range within the polygon
  let minElev = Number.POSITIVE_INFINITY;
  let maxElev = Number.NEGATIVE_INFINITY;
  const worldSize = getTerrainWorldSize(config);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const worldX = gx * config.cellSize - worldSize.width / 2;
      const worldY = gy * config.cellSize - worldSize.height / 2;

      if (!pointInPolygon({ x: worldX, y: worldY }, polygon)) {
        continue;
      }

      const elevation = elevationGrid[gy * gridWidth + gx];

      if (elevation > 0.01) {
        minElev = Math.min(minElev, elevation);
        maxElev = Math.max(maxElev, elevation);
      }
    }
  }

  if (!Number.isFinite(minElev) || !Number.isFinite(maxElev) || maxElev - minElev < 0.5) {
    return [];
  }

  // Choose a nice contour interval
  const range = maxElev - minElev;
  const rawInterval = range / targetLineCount;
  const interval = niceInterval(rawInterval);
  const firstLevel = Math.ceil(minElev / interval) * interval;

  const levels: number[] = [];

  for (let level = firstLevel; level < maxElev; level += interval) {
    if (level > minElev + 0.01) {
      levels.push(level);
    }
  }

  if (levels.length === 0) {
    return [];
  }

  // Run marching squares for each level
  const segments: ContourSegment[] = [];

  for (const level of levels) {
    const rawSegments = marchingSquares(elevationGrid, config, polygon, level);

    if (rawSegments.length > 0) {
      const polylines = joinSegments(rawSegments);

      for (const points of polylines) {
        segments.push({ level, points });
      }
    }
  }

  return segments;
}

/**
 * Pick a "nice" contour interval (1, 2, 5, 10, 20, 50, ...).
 */
function niceInterval(raw: number): number {
  if (raw <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(raw));
  const fraction = raw / 10 ** exponent;
  let niceFraction: number;

  if (fraction <= 1.5) {
    niceFraction = 1;
  } else if (fraction <= 3.5) {
    niceFraction = 2;
  } else if (fraction <= 7.5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return Math.max(0.5, niceFraction * 10 ** exponent);
}

/**
 * Marching squares: for each grid cell, determine which edges the isoline crosses
 * and interpolate the crossing point.
 */
function marchingSquares(
  elevationGrid: Float32Array,
  config: TerrainGridConfig,
  polygon: TerrainPoint[],
  level: number,
): Array<[[number, number, number], [number, number, number]]> {
  const { gridWidth, gridHeight, cellSize } = config;
  const worldSize = getTerrainWorldSize(config);
  const halfW = worldSize.width / 2;
  const halfH = worldSize.height / 2;
  const result: Array<[[number, number, number], [number, number, number]]> = [];

  for (let gy = 0; gy < gridHeight - 1; gy += 1) {
    for (let gx = 0; gx < gridWidth - 1; gx += 1) {
      // Cell center for polygon test
      const cx = (gx + 0.5) * cellSize - halfW;
      const cy = (gy + 0.5) * cellSize - halfH;

      if (!pointInPolygon({ x: cx, y: cy }, polygon)) {
        continue;
      }

      const tl = elevationGrid[gy * gridWidth + gx];
      const tr = elevationGrid[gy * gridWidth + gx + 1];
      const br = elevationGrid[(gy + 1) * gridWidth + gx + 1];
      const bl = elevationGrid[(gy + 1) * gridWidth + gx];

      const cell: MarchingCell = {
        x: gx,
        y: gy,
        values: [tl, tr, br, bl],
      };

      // Build case index (4-bit)
      let caseIndex = 0;

      if (tl >= level) caseIndex |= 8;
      if (tr >= level) caseIndex |= 4;
      if (br >= level) caseIndex |= 2;
      if (bl >= level) caseIndex |= 1;

      // No contour or fully inside
      if (caseIndex === 0 || caseIndex === 15) {
        continue;
      }

      const cellSegments = getCellSegments(cell, level, cellSize, halfW, halfH);

      for (const segment of cellSegments) {
        result.push(segment);
      }
    }
  }

  return result;
}

/**
 * For a given marching-squares case, return the line segment(s) within the cell.
 * Edge numbering: 0=top, 1=right, 2=bottom, 3=left.
 */
function getCellSegments(
  cell: MarchingCell,
  level: number,
  cellSize: number,
  halfW: number,
  halfH: number,
): Array<[[number, number, number], [number, number, number]]> {
  const [tl, tr, br, bl] = cell.values;
  const x0 = cell.x * cellSize - halfW;
  const y0 = cell.y * cellSize - halfH;
  const x1 = x0 + cellSize;
  const y1 = y0 + cellSize;

  function interpTop(): [number, number, number] {
    const t = (level - tl) / ((tr - tl) || 1e-10);
    const wx = x0 + t * (x1 - x0);
    return [wx, level + 0.08, y0];
  }

  function interpRight(): [number, number, number] {
    const t = (level - tr) / ((br - tr) || 1e-10);
    const wy = y0 + t * (y1 - y0);
    return [x1, level + 0.08, wy];
  }

  function interpBottom(): [number, number, number] {
    const t = (level - bl) / ((br - bl) || 1e-10);
    const wx = x0 + t * (x1 - x0);
    return [wx, level + 0.08, y1];
  }

  function interpLeft(): [number, number, number] {
    const t = (level - tl) / ((bl - tl) || 1e-10);
    const wy = y0 + t * (y1 - y0);
    return [x0, level + 0.08, wy];
  }

  let caseIndex = 0;

  if (tl >= level) caseIndex |= 8;
  if (tr >= level) caseIndex |= 4;
  if (br >= level) caseIndex |= 2;
  if (bl >= level) caseIndex |= 1;

  // Lookup table for marching squares
  switch (caseIndex) {
    case 1: return [[interpLeft(), interpBottom()]];
    case 2: return [[interpBottom(), interpRight()]];
    case 3: return [[interpLeft(), interpRight()]];
    case 4: return [[interpTop(), interpRight()]];
    case 5: return [[interpLeft(), interpTop()], [interpBottom(), interpRight()]];
    case 6: return [[interpTop(), interpBottom()]];
    case 7: return [[interpLeft(), interpTop()]];
    case 8: return [[interpTop(), interpLeft()]];
    case 9: return [[interpTop(), interpBottom()]];
    case 10: return [[interpTop(), interpRight()], [interpLeft(), interpBottom()]];
    case 11: return [[interpTop(), interpRight()]];
    case 12: return [[interpLeft(), interpRight()]];
    case 13: return [[interpBottom(), interpRight()]];
    case 14: return [[interpLeft(), interpBottom()]];
    default: return [];
  }
}

/**
 * Join individual segments into polylines where endpoints match.
 */
function joinSegments(
  segments: Array<[[number, number, number], [number, number, number]]>,
): Array<[number, number, number][]> {
  if (segments.length === 0) {
    return [];
  }

  const epsilon = 1e-6;

  function pointKey(p: [number, number, number]): string {
    return `${Math.round(p[0] / epsilon) * epsilon},${Math.round(p[2] / epsilon) * epsilon}`;
  }

  // Build adjacency
  const chains: Array<[number, number, number][]> = segments.map(([a, b]) => [a, b]);
  let merged = true;

  // Simple greedy merge (limited iterations to keep it fast)
  let iterations = 0;
  const maxIterations = chains.length * 2;

  while (merged && iterations < maxIterations) {
    merged = false;
    iterations += 1;

    for (let i = 0; i < chains.length; i += 1) {
      if (chains[i].length === 0) continue;

      const headI = chains[i][0];
      const tailI = chains[i][chains[i].length - 1];
      const tailKey = pointKey(tailI);
      const headKey = pointKey(headI);

      for (let j = i + 1; j < chains.length; j += 1) {
        if (chains[j].length === 0) continue;

        const headJ = chains[j][0];
        const tailJ = chains[j][chains[j].length - 1];

        if (tailKey === pointKey(headJ)) {
          // Append j to i
          chains[i] = [...chains[i], ...chains[j].slice(1)];
          chains[j] = [];
          merged = true;
          break;
        } else if (headKey === pointKey(tailJ)) {
          // Prepend i to j's tail
          chains[i] = [...chains[j], ...chains[i].slice(1)];
          chains[j] = [];
          merged = true;
          break;
        } else if (tailKey === pointKey(tailJ)) {
          // Reverse j and append
          chains[i] = [...chains[i], ...chains[j].slice(0, -1).reverse()];
          chains[j] = [];
          merged = true;
          break;
        } else if (headKey === pointKey(headJ)) {
          // Reverse i and prepend
          chains[i] = [...chains[i].reverse(), ...chains[j].slice(1)];
          chains[j] = [];
          merged = true;
          break;
        }
      }
    }
  }

  return chains.filter((chain) => chain.length >= 2);
}
