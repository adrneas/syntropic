import type { LayoutGuide, LayoutGuideType, WorldPosition } from '../core/types/generation';
import type { TerrainState } from '../core/types/terrain';
import {
  calculatePolygonCentroid,
  clamp,
  getGridIndex,
  gridToWorld,
  worldToGrid,
} from '../core/utils/terrain';

const KEYLINE_FREQUENCY = 4;
const MIN_KEYLINES = 4;
const MAX_KEYLINES = 12;
const MIN_PLANTING_ROWS = 18;
const MAX_PLANTING_ROWS = 72;
const MAX_CONTOUR_LEVELS = 28;
const FLAT_PRODUCTIVE_SLOPE_THRESHOLD_PERCENT = 10;
const GUIDE_BAND_BUFFER_RATIO = 0.55;
const MIN_GUIDE_LENGTH_FACTOR = 1.5;

const MARCHING_SQUARES_CASES: Record<number, Array<[number, number]>> = {
  0: [],
  1: [[3, 0]],
  2: [[0, 1]],
  3: [[3, 1]],
  4: [[1, 2]],
  5: [[3, 0], [1, 2]],
  6: [[0, 2]],
  7: [[3, 2]],
  8: [[2, 3]],
  9: [[0, 2]],
  10: [[0, 1], [2, 3]],
  11: [[1, 2]],
  12: [[3, 1]],
  13: [[0, 1]],
  14: [[3, 0]],
  15: [],
};

interface PlantingLayoutResult {
  contourInterval: number;
  interRows: LayoutGuide[];
  keylines: LayoutGuide[];
  plantingRows: LayoutGuide[];
  rowSpacingMeters: number;
}

interface PolygonStats {
  averageSlopePercent: number;
  flatCellRatio: number;
  maxElevation: number;
  minElevation: number;
  polygonArea: number;
}

interface Segment {
  start: WorldPosition;
  end: WorldPosition;
}

interface SupplementalGuideCandidate {
  averageSlopePercent: number;
  bandCoordinate: number;
  guide: LayoutGuide;
  sectorIndex: number;
}

export function generatePlantingLayout(
  terrain: TerrainState,
  polygonMask: Uint8Array,
  slopeGrid: Float32Array,
  occupationGrid?: Int32Array,
): PlantingLayoutResult {
  const stats = collectPolygonStats(terrain, polygonMask, slopeGrid);

  if (!stats) {
    return {
      contourInterval: 0,
      interRows: [],
      keylines: [],
      plantingRows: [],
      rowSpacingMeters: 0,
    };
  }

  const rowSpacingMeters = determineRowSpacing(stats.averageSlopePercent);
  const guideLimits = determineGuideLimits(stats.polygonArea, rowSpacingMeters);
  const relief = stats.maxElevation - stats.minElevation;
  const contourInterval =
    relief >= 0.5
      ? roundTo(clamp((rowSpacingMeters * Math.max(stats.averageSlopePercent, 4)) / 100, 0.45, 2.4), 2)
      : 0;
  const contourLevels =
    contourInterval > 0
      ? buildContourLevels(stats.minElevation, stats.maxElevation, contourInterval)
      : [];

  const keylines: LayoutGuide[] = [];
  const plantingRows: LayoutGuide[] = [];

  contourLevels.forEach((level, index) => {
    const guideType: LayoutGuideType = index % KEYLINE_FREQUENCY === 0 ? 'KEYLINE' : 'PLANTING_ROW';
    const segments = extractContourSegments(terrain, polygonMask, level);
    const guides = buildLayoutGuides(segments, guideType, level, rowSpacingMeters);

    if (guideType === 'KEYLINE') {
      keylines.push(...guides);
    } else {
      plantingRows.push(...guides);
    }
  });

  const limitedKeylines = limitGuides(keylines, guideLimits.maxKeylines);
  const clippedPlantingRows = clipGuidesAgainstOccupation({
    guides: plantingRows,
    occupationGrid,
    rowSpacingMeters,
    terrain,
  });
  const limitedPlantingRows = limitGuides(clippedPlantingRows, guideLimits.maxPlantingRows);
  const supplementalRows = buildSupplementalPlantingRows({
    existingGuides: [...limitedKeylines, ...limitedPlantingRows],
    existingPlantingRows: limitedPlantingRows,
    maxRows: guideLimits.maxPlantingRows - limitedPlantingRows.length,
    polygonMask,
    rowSpacingMeters,
    slopeGrid,
    stats,
    terrain,
  });
  const clippedSupplementalRows = clipGuidesAgainstOccupation({
    guides: supplementalRows,
    occupationGrid,
    rowSpacingMeters,
    terrain,
  });
  const allPlantingRows = limitGuides(
    [...limitedPlantingRows, ...clippedSupplementalRows],
    guideLimits.maxPlantingRows,
  );
  const interRows = buildInterRowGuides({
    existingGuides: [...limitedKeylines, ...allPlantingRows],
    occupationGrid,
    plantingRows: allPlantingRows,
    polygonMask,
    rowSpacingMeters,
    terrain,
  });

  return {
    contourInterval,
    interRows,
    keylines: limitedKeylines,
    plantingRows: allPlantingRows,
    rowSpacingMeters,
  };
}

function collectPolygonStats(
  terrain: TerrainState,
  polygonMask: Uint8Array,
  slopeGrid: Float32Array,
): PolygonStats | null {
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  let slopeSum = 0;
  let flatCellCount = 0;
  let validCells = 0;

  for (let gridY = 0; gridY < terrain.gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < terrain.gridWidth; gridX += 1) {
      const index = getGridIndex(gridX, gridY, terrain.gridWidth);

      if (polygonMask[index] !== 1) {
        continue;
      }

      const elevation = terrain.elevationGrid[index] ?? 0;
      const slope = slopeGrid[index] ?? 0;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
      slopeSum += slope;
      flatCellCount += slope <= FLAT_PRODUCTIVE_SLOPE_THRESHOLD_PERCENT ? 1 : 0;
      validCells += 1;
    }
  }

  if (validCells === 0) {
    return null;
  }

  return {
    averageSlopePercent: slopeSum / validCells,
    flatCellRatio: flatCellCount / validCells,
    maxElevation,
    minElevation,
    polygonArea: validCells * terrain.cellSize * terrain.cellSize,
  };
}

function determineRowSpacing(averageSlopePercent: number): number {
  if (averageSlopePercent >= 16) {
    return 4;
  }

  if (averageSlopePercent >= 8) {
    return 5;
  }

  return 6;
}

function determineGuideLimits(
  polygonArea: number,
  rowSpacingMeters: number,
): { maxKeylines: number; maxPlantingRows: number } {
  const terrainSpanEstimate = Math.sqrt(Math.max(polygonArea, 1));
  const maxPlantingRows = Math.round(
    clamp(
      (terrainSpanEstimate / Math.max(rowSpacingMeters, 1)) * 1.15,
      MIN_PLANTING_ROWS,
      MAX_PLANTING_ROWS,
    ),
  );

  return {
    maxKeylines: Math.round(
      clamp(Math.ceil(maxPlantingRows / KEYLINE_FREQUENCY), MIN_KEYLINES, MAX_KEYLINES),
    ),
    maxPlantingRows,
  };
}

function buildContourLevels(minElevation: number, maxElevation: number, contourInterval: number): number[] {
  const levels: number[] = [];

  for (
    let level = minElevation + contourInterval;
    level < maxElevation - contourInterval / 2 && levels.length < MAX_CONTOUR_LEVELS;
    level += contourInterval
  ) {
    levels.push(roundTo(level, 2));
  }

  return levels;
}

function buildSupplementalPlantingRows({
  existingGuides,
  existingPlantingRows,
  maxRows,
  polygonMask,
  rowSpacingMeters,
  slopeGrid,
  stats,
  terrain,
}: {
  existingGuides: LayoutGuide[];
  existingPlantingRows: LayoutGuide[];
  maxRows: number;
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  slopeGrid: Float32Array;
  stats: PolygonStats;
  terrain: TerrainState;
}): LayoutGuide[] {
  if (maxRows <= 0) {
    return [];
  }

  const centroid = calculatePolygonCentroid(terrain.polygon) ?? terrain.polygon[0] ?? { x: 0, y: 0 };
  const rowAngle = determineSupplementalRowAngle(existingGuides, terrain);
  const tangent = { x: Math.cos(rowAngle), y: Math.sin(rowAngle) };
  const normal = { x: -tangent.y, y: tangent.x };
  const normalCoordinates = terrain.polygon.map((point) => projectPointOnAxis(point, centroid, normal));

  if (normalCoordinates.length === 0) {
    return [];
  }

  const minNormal = Math.min(...normalCoordinates);
  const maxNormal = Math.max(...normalCoordinates);
  const sectorCount = determineBandSectorCount(minNormal, maxNormal, rowSpacingMeters, maxRows);
  const minimumCoveredSectorCount = Math.max(
    2,
    Math.min(sectorCount, Math.ceil(sectorCount * 0.78)),
  );
  const existingBands = existingGuides.map((guide) =>
    getGuideBandCoordinate(guide, centroid, normal),
  );
  const occupiedSectors = new Set<number>(
    existingBands.map((bandCoordinate) =>
      getBandSectorIndex(bandCoordinate, minNormal, maxNormal, sectorCount),
    ),
  );
  const currentCoverage = estimateProductiveCoverage(existingPlantingRows, rowSpacingMeters);
  const targetCoverage =
    stats.polygonArea * determineTargetCoverageRatio(stats.averageSlopePercent, stats.flatCellRatio);
  const relief = stats.maxElevation - stats.minElevation;
  const minimumBandSeparation = rowSpacingMeters * GUIDE_BAND_BUFFER_RATIO;

  if (currentCoverage >= targetCoverage && occupiedSectors.size >= minimumCoveredSectorCount) {
    return [];
  }

  const candidates: SupplementalGuideCandidate[] = [];

  for (
    let bandCoordinate = minNormal + rowSpacingMeters / 2, bandIndex = 0;
    bandCoordinate <= maxNormal - rowSpacingMeters / 2;
    bandCoordinate += rowSpacingMeters, bandIndex += 1
  ) {
    const hasNearbyGuide = existingBands.some(
      (existingBand) =>
        Math.abs(existingBand - bandCoordinate) < minimumBandSeparation,
    );

    if (hasNearbyGuide) {
      continue;
    }

    candidates.push(
      ...sampleSupplementalGuidesForBand({
        bandCoordinate,
        bandIndex,
        centroid,
        minNormal,
        maxNormal,
        normal,
        polygonMask,
        rowSpacingMeters,
        sectorCount,
        slopeGrid,
        tangent,
        terrain,
      }),
    );
  }

  if (candidates.length === 0) {
    return [];
  }

  const selected: LayoutGuide[] = [];
  const occupiedBands = [...existingBands];
  let accumulatedCoverage = currentCoverage;
  const selectedGuideIds = new Set<string>();

  const trySelectCandidate = (candidate: SupplementalGuideCandidate | null) => {
    if (!candidate || selectedGuideIds.has(candidate.guide.id) || selected.length >= maxRows) {
      return false;
    }

    const hasNearbySelectedBand = occupiedBands.some(
      (existingBand) =>
        Math.abs(existingBand - candidate.bandCoordinate) <
        minimumBandSeparation,
    );

    if (hasNearbySelectedBand) {
      return false;
    }

    selected.push(candidate.guide);
    selectedGuideIds.add(candidate.guide.id);
    occupiedBands.push(candidate.bandCoordinate);
    occupiedSectors.add(candidate.sectorIndex);
    accumulatedCoverage += candidate.guide.length * rowSpacingMeters;

    return true;
  };

  const sectorPriorityOrder = buildSectorPriorityOrder(sectorCount);
  const crestThreshold = stats.maxElevation - Math.max(rowSpacingMeters * 0.22, relief * 0.18);

  for (let index = 0; index < sectorPriorityOrder.length; index += 1) {
    if (selected.length >= maxRows) {
      break;
    }

    const sectorIndex = sectorPriorityOrder[index];

    if (occupiedSectors.has(sectorIndex)) {
      continue;
    }

    const sectorCandidate = pickBestSupplementalCandidate({
      candidates,
      crestThreshold,
      maxNormal,
      minNormal,
      minimumBandSeparation,
      occupiedBands,
      occupiedSectors,
      sectorIndex,
      selectedGuideIds,
    });

    trySelectCandidate(sectorCandidate);
  }

  const hasCrestCoverage =
    [...existingPlantingRows, ...selected].some(
      (guide) => guide.averageElevation >= crestThreshold,
    );

  if (!hasCrestCoverage) {
    trySelectCandidate(
      pickBestSupplementalCandidate({
        candidates,
        crestThreshold,
        maxNormal,
        minNormal,
        minimumBandSeparation,
        occupiedBands,
        occupiedSectors,
        selectedGuideIds,
      }),
    );
  }

  while (selected.length < maxRows) {
    const coverageSatisfied =
      accumulatedCoverage >= targetCoverage &&
      occupiedSectors.size >= minimumCoveredSectorCount;

    if (coverageSatisfied) {
      break;
    }

    const nextCandidate = pickBestSupplementalCandidate({
      candidates,
      crestThreshold,
      maxNormal,
      minNormal,
      minimumBandSeparation,
      occupiedBands,
      occupiedSectors,
      selectedGuideIds,
    });

    if (!trySelectCandidate(nextCandidate)) {
      break;
    }
  }

  return selected;
}

function buildInterRowGuides({
  existingGuides,
  occupationGrid,
  plantingRows,
  polygonMask,
  rowSpacingMeters,
  terrain,
}: {
  existingGuides: LayoutGuide[];
  occupationGrid?: Int32Array;
  plantingRows: LayoutGuide[];
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  terrain: TerrainState;
}): LayoutGuide[] {
  // Interrows are temporarily disabled until a new geometric model is implemented.
  if (rowSpacingMeters > 0) {
    return [];
  }

  if (plantingRows.length < 2) {
    return [];
  }

  const centroid = calculatePolygonCentroid(terrain.polygon) ?? terrain.polygon[0] ?? { x: 0, y: 0 };
  const rowAngle = determineSupplementalRowAngle(existingGuides, terrain);
  const tangent = { x: Math.cos(rowAngle), y: Math.sin(rowAngle) };
  const normal = { x: -tangent.y, y: tangent.x };
  const sortedBands = plantingRows
    .map((guide) => ({
      bandCoordinate: getGuideBandCoordinate(guide, centroid, normal),
      guide,
    }))
    .sort((left, right) => left.bandCoordinate - right.bandCoordinate);
  const interRows: LayoutGuide[] = [];

  for (let index = 0; index < sortedBands.length - 1; index += 1) {
    const current = sortedBands[index];
    const next = sortedBands[index + 1];
    const distanceBetweenBands = next.bandCoordinate - current.bandCoordinate;

    if (
      distanceBetweenBands < rowSpacingMeters * 0.6 ||
      distanceBetweenBands > rowSpacingMeters * 1.8
    ) {
      continue;
    }

    const candidates = buildInterpolatedInterRowGuides({
      currentGuide: current.guide,
      guideIndex: index,
      nextGuide: next.guide,
      occupationGrid,
      polygonMask,
      rowSpacingMeters,
      terrain,
    });

    interRows.push(...candidates);
  }

  return prioritizeGuidesFromCenter(
    limitGuides(interRows, plantingRows.length),
    centroid,
    normal,
  );
}

function buildInterpolatedInterRowGuides({
  currentGuide,
  guideIndex,
  nextGuide,
  occupationGrid,
  polygonMask,
  rowSpacingMeters,
  terrain,
}: {
  currentGuide: LayoutGuide;
  guideIndex: number;
  nextGuide: LayoutGuide;
  occupationGrid?: Int32Array;
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  terrain: TerrainState;
}): LayoutGuide[] {
  if (currentGuide.points.length < 2 || nextGuide.points.length < 2) {
    return [];
  }

  const alignedNextGuidePoints = alignGuideDirections(currentGuide.points, nextGuide.points);
  const sampleCount = Math.round(
    clamp(
      Math.max(currentGuide.length, nextGuide.length) / Math.max(terrain.cellSize * 1.15, 1),
      10,
      240,
    ),
  );
  const currentSamples = resampleGuidePoints(currentGuide.points, sampleCount);
  const nextSamples = resampleGuidePoints(alignedNextGuidePoints, sampleCount);
  const samples: Array<{
    currentPoint: WorldPosition;
    midpoint: WorldPosition;
    nextPoint: WorldPosition;
  }> = [];

  for (let index = 0; index < currentSamples.length; index += 1) {
    const currentPoint = currentSamples[index];
    const nextPoint = nextSamples[index];
    const x = roundTo((currentPoint.x + nextPoint.x) / 2, 3);
    const y = roundTo((currentPoint.y + nextPoint.y) / 2, 3);
    const grid = worldToGrid(x, y, terrain);
    const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);

    samples.push({
      currentPoint,
      midpoint: {
        x,
        y,
        z: roundTo(terrain.elevationGrid[gridIndex] ?? (currentPoint.z + nextPoint.z) / 2, 2),
      },
      nextPoint,
    });
  }

  return splitInterpolatedInterRowSegments({
    guideIndex,
    occupationGrid,
    samples,
    polygonMask,
    rowSpacingMeters,
    terrain,
  });
}

function extractContourSegments(
  terrain: TerrainState,
  polygonMask: Uint8Array,
  level: number,
): Segment[] {
  const segments: Segment[] = [];

  for (let gridY = 0; gridY < terrain.gridHeight - 1; gridY += 1) {
    for (let gridX = 0; gridX < terrain.gridWidth - 1; gridX += 1) {
      const topLeftIndex = getGridIndex(gridX, gridY, terrain.gridWidth);
      const topRightIndex = getGridIndex(gridX + 1, gridY, terrain.gridWidth);
      const bottomRightIndex = getGridIndex(gridX + 1, gridY + 1, terrain.gridWidth);
      const bottomLeftIndex = getGridIndex(gridX, gridY + 1, terrain.gridWidth);
      const inclusionCount =
        polygonMask[topLeftIndex] +
        polygonMask[topRightIndex] +
        polygonMask[bottomRightIndex] +
        polygonMask[bottomLeftIndex];

      if (inclusionCount === 0) {
        continue;
      }

      const values = [
        terrain.elevationGrid[topLeftIndex] ?? 0,
        terrain.elevationGrid[topRightIndex] ?? 0,
        terrain.elevationGrid[bottomRightIndex] ?? 0,
        terrain.elevationGrid[bottomLeftIndex] ?? 0,
      ];
      const caseIndex =
        (values[0] >= level ? 1 : 0) |
        (values[1] >= level ? 2 : 0) |
        (values[2] >= level ? 4 : 0) |
        (values[3] >= level ? 8 : 0);
      const caseSegments = MARCHING_SQUARES_CASES[caseIndex];

      if (!caseSegments || caseSegments.length === 0) {
        continue;
      }

      const corners = [
        gridToWorld(gridX, gridY, terrain),
        gridToWorld(gridX + 1, gridY, terrain),
        gridToWorld(gridX + 1, gridY + 1, terrain),
        gridToWorld(gridX, gridY + 1, terrain),
      ];

      caseSegments.forEach(([startEdge, endEdge]) => {
        const start = interpolateEdge(corners, values, startEdge, level);
        const end = interpolateEdge(corners, values, endEdge, level);

        if (!start || !end) {
          return;
        }

        segments.push({ end, start });
      });
    }
  }

  return segments;
}

function buildLayoutGuides(
  segments: Segment[],
  type: LayoutGuideType,
  level: number,
  rowSpacingMeters: number,
): LayoutGuide[] {
  const polylines = joinSegmentsToPolylines(segments);

  return polylines
    .map((points, index) => ({
      averageElevation: roundTo(level, 2),
      id: `${type.toLowerCase()}-${roundTo(level, 2)}-${index}`,
      length: roundTo(calculatePolylineLength(points), 2),
      points: simplifyPolyline(points),
      type,
    }))
    .filter(
      (guide) =>
        guide.length >= rowSpacingMeters * MIN_GUIDE_LENGTH_FACTOR && guide.points.length >= 2,
    );
}

function sampleSupplementalGuidesForBand({
  bandCoordinate,
  bandIndex,
  centroid,
  maxNormal,
  minNormal,
  normal,
  polygonMask,
  rowSpacingMeters,
  sectorCount,
  slopeGrid,
  tangent,
  terrain,
}: {
  bandCoordinate: number;
  bandIndex: number;
  centroid: { x: number; y: number };
  maxNormal: number;
  minNormal: number;
  normal: { x: number; y: number };
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  sectorCount: number;
  slopeGrid: Float32Array;
  tangent: { x: number; y: number };
  terrain: TerrainState;
}): SupplementalGuideCandidate[] {
  return sampleGuidesForBand({
    bandCoordinate,
    bandIndex,
    centroid,
    guideIdPrefix: 'planting_row-flat',
    guideType: 'PLANTING_ROW',
    maxNormal,
    minNormal,
    normal,
    polygonMask,
    rowSpacingMeters,
    sectorCount,
    slopeGrid,
    tangent,
    terrain,
  });
}

function sampleGuidesForBand({
  bandCoordinate,
  bandIndex,
  centroid,
  guideIdPrefix,
  guideType,
  maxNormal,
  minNormal,
  normal,
  polygonMask,
  rowSpacingMeters,
  sectorCount,
  slopeGrid,
  tangent,
  terrain,
}: {
  bandCoordinate: number;
  bandIndex: number;
  centroid: { x: number; y: number };
  guideIdPrefix: string;
  guideType: LayoutGuideType;
  maxNormal?: number;
  minNormal?: number;
  normal: { x: number; y: number };
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  sectorCount?: number;
  slopeGrid: Float32Array;
  tangent: { x: number; y: number };
  terrain: TerrainState;
}): SupplementalGuideCandidate[] {
  const tangentCoordinates = terrain.polygon.map((point) => projectPointOnAxis(point, centroid, tangent));
  const minTangent = Math.min(...tangentCoordinates) - terrain.cellSize;
  const maxTangent = Math.max(...tangentCoordinates) + terrain.cellSize;
  const candidates: SupplementalGuideCandidate[] = [];
  let currentPoints: WorldPosition[] = [];
  let currentSlopeSum = 0;
  let currentSlopeSamples = 0;
  let previousGridKey: string | null = null;
  let segmentIndex = 0;

  const flushCurrentSegment = () => {
    if (currentPoints.length < 2) {
      currentPoints = [];
      currentSlopeSum = 0;
      currentSlopeSamples = 0;
      previousGridKey = null;
      return;
    }

    const guide = buildSupplementalGuide(currentPoints, bandIndex, guideIdPrefix, guideType, segmentIndex);

    if (guide.length >= rowSpacingMeters * MIN_GUIDE_LENGTH_FACTOR) {
      candidates.push({
        averageSlopePercent:
          currentSlopeSamples > 0 ? currentSlopeSum / currentSlopeSamples : Number.POSITIVE_INFINITY,
        bandCoordinate,
        guide,
        sectorIndex:
          minNormal !== undefined && maxNormal !== undefined && sectorCount
            ? getBandSectorIndex(bandCoordinate, minNormal, maxNormal, sectorCount)
            : 0,
      });
    }

    currentPoints = [];
    currentSlopeSum = 0;
    currentSlopeSamples = 0;
    previousGridKey = null;
  };

  for (
    let tangentCoordinate = minTangent;
    tangentCoordinate <= maxTangent;
    tangentCoordinate += terrain.cellSize
  ) {
    const samplePoint = {
      x: centroid.x + tangent.x * tangentCoordinate + normal.x * bandCoordinate,
      y: centroid.y + tangent.y * tangentCoordinate + normal.y * bandCoordinate,
    };
    const grid = worldToGrid(samplePoint.x, samplePoint.y, terrain);
    const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);

    if (polygonMask[gridIndex] !== 1) {
      flushCurrentSegment();
      segmentIndex += 1;
      continue;
    }

    const gridKey = `${grid.x}:${grid.y}`;

    if (previousGridKey === gridKey) {
      continue;
    }

    currentPoints.push({
      x: roundTo(samplePoint.x, 3),
      y: roundTo(samplePoint.y, 3),
      z: roundTo(terrain.elevationGrid[gridIndex] ?? 0, 2),
    });
    currentSlopeSum += slopeGrid[gridIndex] ?? 0;
    currentSlopeSamples += 1;
    previousGridKey = gridKey;
  }

  flushCurrentSegment();

  return candidates;
}

function buildSupplementalGuide(
  points: WorldPosition[],
  bandIndex: number,
  guideIdPrefix: string,
  guideType: LayoutGuideType,
  segmentIndex: number,
): LayoutGuide {
  const simplifiedPoints = simplifyPolyline(points);

  return {
    averageElevation: roundTo(
      simplifiedPoints.reduce((sum, point) => sum + point.z, 0) / simplifiedPoints.length,
      2,
    ),
    id: `${guideIdPrefix}-${bandIndex}-${segmentIndex}`,
    length: roundTo(calculatePolylineLength(simplifiedPoints), 2),
    points: simplifiedPoints,
    type: guideType,
  };
}

function clipGuidesAgainstOccupation({
  guides,
  occupationGrid,
  rowSpacingMeters,
  terrain,
}: {
  guides: LayoutGuide[];
  occupationGrid?: Int32Array;
  rowSpacingMeters: number;
  terrain: TerrainState;
}): LayoutGuide[] {
  if (!occupationGrid || guides.length === 0) {
    return guides;
  }

  return guides.flatMap((guide, guideIndex) =>
    splitGuideAroundOccupation({
      guide,
      guideIndex,
      occupationGrid,
      rowSpacingMeters,
      terrain,
    }),
  );
}

function splitGuideAroundOccupation({
  guide,
  guideIndex,
  occupationGrid,
  rowSpacingMeters,
  terrain,
}: {
  guide: LayoutGuide;
  guideIndex: number;
  occupationGrid: Int32Array;
  rowSpacingMeters: number;
  terrain: TerrainState;
}): LayoutGuide[] {
  if (guide.points.length < 2) {
    return [];
  }

  const sampleCount = Math.round(
    clamp(
      guide.length / Math.max(terrain.cellSize * 0.5, 0.35),
      8,
      640,
    ),
  );
  const samples = resampleGuidePoints(guide.points, sampleCount);
  const clippedGuides: LayoutGuide[] = [];
  let currentPoints: WorldPosition[] = [];
  let previousGridKey: string | null = null;
  let segmentIndex = 0;

  const flushCurrentSegment = () => {
    if (currentPoints.length < 2) {
      currentPoints = [];
      previousGridKey = null;
      return;
    }

    const clippedGuide = buildSupplementalGuide(
      currentPoints,
      guideIndex,
      `${guide.id}-clipped`,
      guide.type,
      segmentIndex,
    );

    if (clippedGuide.length >= rowSpacingMeters * MIN_GUIDE_LENGTH_FACTOR) {
      clippedGuides.push(clippedGuide);
    }

    currentPoints = [];
    previousGridKey = null;
    segmentIndex += 1;
  };

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const grid = worldToGrid(sample.x, sample.y, terrain);

    if (
      hasBlockingOccupationNearby(
        occupationGrid,
        terrain.gridWidth,
        terrain.gridHeight,
        grid.x,
        grid.y,
        1,
      )
    ) {
      flushCurrentSegment();
      continue;
    }

    const gridKey = `${grid.x}:${grid.y}`;

    if (gridKey === previousGridKey) {
      continue;
    }

    currentPoints.push(sample);
    previousGridKey = gridKey;
  }

  flushCurrentSegment();

  return clippedGuides;
}

function alignGuideDirections(
  referencePoints: WorldPosition[],
  candidatePoints: WorldPosition[],
): WorldPosition[] {
  const referenceStart = referencePoints[0];
  const referenceEnd = referencePoints[referencePoints.length - 1];
  const candidateStart = candidatePoints[0];
  const candidateEnd = candidatePoints[candidatePoints.length - 1];
  const alignedDistance =
    calculatePointDistance(referenceStart, candidateStart) +
    calculatePointDistance(referenceEnd, candidateEnd);
  const reversedDistance =
    calculatePointDistance(referenceStart, candidateEnd) +
    calculatePointDistance(referenceEnd, candidateStart);

  return reversedDistance < alignedDistance ? [...candidatePoints].reverse() : candidatePoints;
}

function resampleGuidePoints(points: WorldPosition[], sampleCount: number): WorldPosition[] {
  if (points.length <= 1 || sampleCount <= 1) {
    return [...points];
  }

  const cumulativeLengths = [0];

  for (let index = 1; index < points.length; index += 1) {
    cumulativeLengths.push(
      cumulativeLengths[index - 1] + calculatePointDistance(points[index - 1], points[index]),
    );
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;

  if (totalLength <= Number.EPSILON) {
    return [...points];
  }

  const resampled: WorldPosition[] = [];

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const targetDistance = (totalLength * sampleIndex) / sampleCount;
    resampled.push(samplePointAlongPolyline(points, cumulativeLengths, targetDistance));
  }

  return resampled;
}

function samplePointAlongPolyline(
  points: WorldPosition[],
  cumulativeLengths: number[],
  targetDistance: number,
): WorldPosition {
  if (targetDistance <= 0) {
    return { ...points[0] };
  }

  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;

  if (targetDistance >= totalLength) {
    return { ...points[points.length - 1] };
  }

  for (let index = 1; index < cumulativeLengths.length; index += 1) {
    if (targetDistance > cumulativeLengths[index]) {
      continue;
    }

    const previousLength = cumulativeLengths[index - 1];
    const segmentLength = cumulativeLengths[index] - previousLength;
    const factor =
      segmentLength <= Number.EPSILON ? 0 : (targetDistance - previousLength) / segmentLength;
    const start = points[index - 1];
    const end = points[index];

    return {
      x: roundTo(start.x + (end.x - start.x) * factor, 3),
      y: roundTo(start.y + (end.y - start.y) * factor, 3),
      z: roundTo(start.z + (end.z - start.z) * factor, 2),
    };
  }

  return { ...points[points.length - 1] };
}

function splitInterpolatedInterRowSegments({
  guideIndex,
  occupationGrid,
  samples,
  polygonMask,
  rowSpacingMeters,
  terrain,
}: {
  guideIndex: number;
  occupationGrid?: Int32Array;
  samples: Array<{
    currentPoint: WorldPosition;
    midpoint: WorldPosition;
    nextPoint: WorldPosition;
  }>;
  polygonMask: Uint8Array;
  rowSpacingMeters: number;
  terrain: TerrainState;
}): LayoutGuide[] {
  const guides: LayoutGuide[] = [];
  let currentBoundary: WorldPosition[] = [];
  let currentSegment: WorldPosition[] = [];
  let nextBoundary: WorldPosition[] = [];
  let previousGridKey: string | null = null;
  let segmentIndex = 0;

  const flushSegment = () => {
    if (currentSegment.length < 2) {
      currentBoundary = [];
      currentSegment = [];
      nextBoundary = [];
      previousGridKey = null;
      return;
    }

    const guide = buildSupplementalGuide(
      currentSegment,
      guideIndex,
      'interrow',
      'INTERROW',
      segmentIndex,
    );
    const areaPolygon = [...currentBoundary, ...[...nextBoundary].reverse()];

    if (
      guide.length >= rowSpacingMeters * MIN_GUIDE_LENGTH_FACTOR &&
      areaPolygon.length >= 4
    ) {
      guides.push({
        ...guide,
        areaPolygon,
      });
    }

    currentBoundary = [];
    currentSegment = [];
    nextBoundary = [];
    previousGridKey = null;
    segmentIndex += 1;
  };

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const grid = worldToGrid(sample.midpoint.x, sample.midpoint.y, terrain);

    if (
      isInterRowSampleBlocked(
        occupationGrid,
        polygonMask,
        terrain,
        sample.currentPoint,
        sample.midpoint,
        sample.nextPoint,
      )
    ) {
      flushSegment();
      continue;
    }

    const gridKey = `${grid.x}:${grid.y}`;

    if (gridKey === previousGridKey) {
      continue;
    }

    currentBoundary.push(sample.currentPoint);
    currentSegment.push(sample.midpoint);
    nextBoundary.push(sample.nextPoint);
    previousGridKey = gridKey;
  }

  flushSegment();

  return guides;
}

function isInterRowSampleBlocked(
  occupationGrid: Int32Array | undefined,
  polygonMask: Uint8Array,
  terrain: TerrainState,
  ...points: WorldPosition[]
): boolean {
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex];
    const end = points[pointIndex + 1] ?? start;

    for (let interpolationIndex = 0; interpolationIndex <= 2; interpolationIndex += 1) {
      const factor = interpolationIndex / 2;
      const x = roundTo(start.x + (end.x - start.x) * factor, 3);
      const y = roundTo(start.y + (end.y - start.y) * factor, 3);
      const grid = worldToGrid(x, y, terrain);
      const gridIndex = getGridIndex(grid.x, grid.y, terrain.gridWidth);

      if (polygonMask[gridIndex] !== 1) {
        return true;
      }

      if (
        hasBlockingOccupationNearby(
          occupationGrid,
          terrain.gridWidth,
          terrain.gridHeight,
          grid.x,
          grid.y,
          1,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function hasBlockingOccupationNearby(
  occupationGrid: Int32Array | undefined,
  gridWidth: number,
  gridHeight: number,
  centerX: number,
  centerY: number,
  radiusCells: number,
): boolean {
  if (!occupationGrid) {
    return false;
  }

  for (let offsetY = -radiusCells; offsetY <= radiusCells; offsetY += 1) {
    for (let offsetX = -radiusCells; offsetX <= radiusCells; offsetX += 1) {
      const gridX = centerX + offsetX;
      const gridY = centerY + offsetY;

      if (gridX < 0 || gridX >= gridWidth || gridY < 0 || gridY >= gridHeight) {
        continue;
      }

      const occupancyValue = occupationGrid[getGridIndex(gridX, gridY, gridWidth)] ?? 0;

      if (occupancyValue !== 0 && occupancyValue !== -4) {
        return true;
      }
    }
  }

  return false;
}

function joinSegmentsToPolylines(segments: Segment[]): WorldPosition[][] {
  const polylines: Array<WorldPosition[] | null> = [];
  const endpointMap = new Map<string, { at: 'start' | 'end'; index: number }>();

  const unregisterEndpoints = (index: number) => {
    const polyline = polylines[index];

    if (!polyline || polyline.length === 0) {
      return;
    }

    endpointMap.delete(buildPointKey(polyline[0]));
    endpointMap.delete(buildPointKey(polyline[polyline.length - 1]));
  };

  const registerEndpoints = (index: number) => {
    const polyline = polylines[index];

    if (!polyline || polyline.length === 0) {
      return;
    }

    endpointMap.set(buildPointKey(polyline[0]), { at: 'start', index });
    endpointMap.set(buildPointKey(polyline[polyline.length - 1]), { at: 'end', index });
  };

  segments.forEach((segment) => {
    const startKey = buildPointKey(segment.start);
    const endKey = buildPointKey(segment.end);
    const startMatch = endpointMap.get(startKey);
    const endMatch = endpointMap.get(endKey);

    if (!startMatch && !endMatch) {
      const polyline = [segment.start, segment.end];
      const index = polylines.push(polyline) - 1;
      registerEndpoints(index);
      return;
    }

    if (startMatch && !endMatch) {
      const polyline = polylines[startMatch.index];

      if (!polyline) {
        return;
      }

      unregisterEndpoints(startMatch.index);

      if (startMatch.at === 'start') {
        polyline.reverse();
      }

      polyline.push(segment.end);
      registerEndpoints(startMatch.index);
      return;
    }

    if (!startMatch && endMatch) {
      const polyline = polylines[endMatch.index];

      if (!polyline) {
        return;
      }

      unregisterEndpoints(endMatch.index);

      if (endMatch.at === 'start') {
        polyline.reverse();
      }

      polyline.push(segment.start);
      registerEndpoints(endMatch.index);
      return;
    }

    if (!startMatch || !endMatch) {
      return;
    }

    if (startMatch.index === endMatch.index) {
      return;
    }

    const startPolyline = polylines[startMatch.index];
    const endPolyline = polylines[endMatch.index];

    if (!startPolyline || !endPolyline) {
      return;
    }

    unregisterEndpoints(startMatch.index);
    unregisterEndpoints(endMatch.index);

    if (startMatch.at === 'start') {
      startPolyline.reverse();
    }

    if (endMatch.at === 'end') {
      endPolyline.reverse();
    }

    polylines[startMatch.index] = [...startPolyline, ...endPolyline];
    polylines[endMatch.index] = null;
    registerEndpoints(startMatch.index);
  });

  return polylines.filter((polyline): polyline is WorldPosition[] => Boolean(polyline));
}

function interpolateEdge(
  corners: ReturnType<typeof gridToWorld>[],
  values: number[],
  edge: number,
  level: number,
): WorldPosition | null {
  switch (edge) {
    case 0:
      return interpolatePoint(corners[0], corners[1], values[0], values[1], level);
    case 1:
      return interpolatePoint(corners[1], corners[2], values[1], values[2], level);
    case 2:
      return interpolatePoint(corners[2], corners[3], values[2], values[3], level);
    case 3:
      return interpolatePoint(corners[3], corners[0], values[3], values[0], level);
    default:
      return null;
  }
}

function interpolatePoint(
  start: ReturnType<typeof gridToWorld>,
  end: ReturnType<typeof gridToWorld>,
  startValue: number,
  endValue: number,
  level: number,
): WorldPosition {
  const factor =
    Math.abs(endValue - startValue) <= Number.EPSILON
      ? 0.5
      : clamp((level - startValue) / (endValue - startValue), 0, 1);

  return {
    x: roundTo(start.x + (end.x - start.x) * factor, 3),
    y: roundTo(start.y + (end.y - start.y) * factor, 3),
    z: roundTo(level, 2),
  };
}

function calculatePolylineLength(points: WorldPosition[]): number {
  let length = 0;

  for (let index = 1; index < points.length; index += 1) {
    length += calculatePointDistance(points[index], points[index - 1]);
  }

  return length;
}

function calculatePointDistance(
  left: Pick<WorldPosition, 'x' | 'y'>,
  right: Pick<WorldPosition, 'x' | 'y'>,
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function estimateProductiveCoverage(guides: LayoutGuide[], rowSpacingMeters: number): number {
  return guides.reduce((sum, guide) => sum + guide.length * rowSpacingMeters, 0);
}

function determineTargetCoverageRatio(averageSlopePercent: number, flatCellRatio: number): number {
  if (flatCellRatio >= 0.7 || averageSlopePercent <= FLAT_PRODUCTIVE_SLOPE_THRESHOLD_PERCENT) {
    return 0.82;
  }

  if (flatCellRatio >= 0.45 || averageSlopePercent <= 14) {
    return 0.7;
  }

  return 0.58;
}

function determineSupplementalRowAngle(existingGuides: LayoutGuide[], terrain: TerrainState): number {
  const longestGuide = existingGuides.reduce<LayoutGuide | null>(
    (best, guide) => (!best || guide.length > best.length ? guide : best),
    null,
  );

  if (longestGuide && longestGuide.points.length >= 2) {
    const firstPoint = longestGuide.points[0];
    const lastPoint = longestGuide.points[longestGuide.points.length - 1];
    return normalizeGuideAngle(Math.atan2(lastPoint.y - firstPoint.y, lastPoint.x - firstPoint.x));
  }

  let dominantAngle = 0;
  let longestEdgeLength = 0;

  for (let index = 0; index < terrain.polygon.length; index += 1) {
    const currentPoint = terrain.polygon[index];
    const nextPoint = terrain.polygon[(index + 1) % terrain.polygon.length];
    const edgeLength = Math.hypot(nextPoint.x - currentPoint.x, nextPoint.y - currentPoint.y);

    if (edgeLength <= longestEdgeLength) {
      continue;
    }

    longestEdgeLength = edgeLength;
    dominantAngle = Math.atan2(nextPoint.y - currentPoint.y, nextPoint.x - currentPoint.x);
  }

  return normalizeGuideAngle(dominantAngle);
}

function determineBandSectorCount(
  minNormal: number,
  maxNormal: number,
  rowSpacingMeters: number,
  maxRows: number,
): number {
  const span = Math.max(maxNormal - minNormal, rowSpacingMeters);

  return Math.round(
    clamp(
      span / Math.max(rowSpacingMeters * 1.8, 1),
      3,
      Math.max(3, maxRows + 2),
    ),
  );
}

function getBandSectorIndex(
  bandCoordinate: number,
  minNormal: number,
  maxNormal: number,
  sectorCount: number,
): number {
  if (sectorCount <= 1 || Math.abs(maxNormal - minNormal) <= Number.EPSILON) {
    return 0;
  }

  const normalized =
    clamp((bandCoordinate - minNormal) / Math.max(maxNormal - minNormal, Number.EPSILON), 0, 0.9999);

  return Math.floor(normalized * sectorCount);
}

function buildSectorPriorityOrder(sectorCount: number): number[] {
  const order: number[] = [];
  let left = 0;
  let right = sectorCount - 1;

  while (left <= right) {
    order.push(left);

    if (right !== left) {
      order.push(right);
    }

    left += 1;
    right -= 1;
  }

  return order;
}

function pickBestSupplementalCandidate({
  candidates,
  crestThreshold,
  maxNormal,
  minNormal,
  minimumBandSeparation,
  occupiedBands,
  occupiedSectors,
  sectorIndex,
  selectedGuideIds,
}: {
  candidates: SupplementalGuideCandidate[];
  crestThreshold: number;
  maxNormal: number;
  minNormal: number;
  minimumBandSeparation: number;
  occupiedBands: number[];
  occupiedSectors: Set<number>;
  sectorIndex?: number;
  selectedGuideIds: Set<string>;
}): SupplementalGuideCandidate | null {
  const span = Math.max(maxNormal - minNormal, minimumBandSeparation);
  let bestCandidate: SupplementalGuideCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    if (selectedGuideIds.has(candidate.guide.id)) {
      continue;
    }

    if (sectorIndex !== undefined && candidate.sectorIndex !== sectorIndex) {
      continue;
    }

    const nearestOccupiedDistance =
      occupiedBands.length === 0
        ? span
        : occupiedBands.reduce(
            (nearest, occupiedBand) =>
              Math.min(nearest, Math.abs(occupiedBand - candidate.bandCoordinate)),
            Number.POSITIVE_INFINITY,
          );

    if (nearestOccupiedDistance < minimumBandSeparation) {
      continue;
    }

    const uncoveredSectorBonus = occupiedSectors.has(candidate.sectorIndex) ? 0 : 60;
    const crestDelta = candidate.guide.averageElevation - crestThreshold;
    const crestBonus = crestDelta >= 0 ? 85 : Math.max(0, 24 + crestDelta * 12);
    const spacingBonus =
      Math.min(nearestOccupiedDistance, minimumBandSeparation * 3.2) * 16;
    const score =
      candidate.guide.length * 3.1 +
      spacingBonus +
      uncoveredSectorBonus +
      crestBonus -
      candidate.averageSlopePercent * 1.35;

    if (
      !bestCandidate ||
      score > bestScore ||
      (score === bestScore && candidate.guide.averageElevation > bestCandidate.guide.averageElevation)
    ) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  return bestCandidate;
}

function prioritizeGuidesFromCenter(
  guides: LayoutGuide[],
  centroid: { x: number; y: number },
  normal: { x: number; y: number },
): LayoutGuide[] {
  const focusedGuides = [...guides]
    .sort(
      (left, right) =>
        Math.abs(getGuideBandCoordinate(left, centroid, normal)) -
          Math.abs(getGuideBandCoordinate(right, centroid, normal)) ||
        right.length - left.length ||
        right.averageElevation - left.averageElevation,
    )
    .slice(0, Math.min(2, guides.length));
  const prioritizedGuideIds = new Set(focusedGuides.map((guide) => guide.id));

  return [...focusedGuides, ...guides.filter((guide) => !prioritizedGuideIds.has(guide.id))];
}

function getGuideBandCoordinate(
  guide: LayoutGuide,
  centroid: { x: number; y: number },
  normal: { x: number; y: number },
): number {
  const point = guide.points[Math.floor(guide.points.length / 2)] ?? guide.points[0];
  return projectPointOnAxis(point, centroid, normal);
}

function projectPointOnAxis(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  axis: { x: number; y: number },
): number {
  return (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y;
}

function normalizeGuideAngle(angle: number): number {
  const halfTurn = Math.PI;
  const normalized = angle % halfTurn;
  return normalized < 0 ? normalized + halfTurn : normalized;
}

function simplifyPolyline(points: WorldPosition[]): WorldPosition[] {
  if (points.length <= 2) {
    return points;
  }

  const simplified = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);

    if (Math.abs(cross) > 0.005) {
      simplified.push(current);
    }
  }

  simplified.push(points[points.length - 1]);

  return simplified;
}

function buildPointKey(point: WorldPosition): string {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}:${point.z.toFixed(2)}`;
}

function limitGuides(guides: LayoutGuide[], maxCount: number): LayoutGuide[] {
  return guides
    .sort((left, right) => right.length - left.length || right.averageElevation - left.averageElevation)
    .slice(0, maxCount)
    .sort((left, right) => right.averageElevation - left.averageElevation);
}

function roundTo(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}
