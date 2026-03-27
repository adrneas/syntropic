import type {
  GridCoordinate,
  InfrastructurePlacement,
  ResidencePlacement,
} from '../core/types/generation';
import type { ProceduralEngineInput } from './types';

// D8 neighbor offsets matching topography.ts flow direction encoding
const D8_OFFSETS = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
] as const;

export interface BotanicalServiceAnchor {
  center: GridCoordinate;
  influence?: 'NONE' | 'FERTILITY' | 'POLLINATION' | 'FERTIGATION' | 'NURSERY';
  kind: 'ANIMAL' | 'AGUA' | 'PROCESSAMENTO' | 'RESIDENCE';
  radiusMeters: number;
}

export function buildBotanicalServiceAnchors(
  residence: ResidencePlacement,
  placements: InfrastructurePlacement[],
  flowDirectionGrid?: Int8Array,
  terrain?: ProceduralEngineInput['terrain'],
): BotanicalServiceAnchor[] {
  const anchors: BotanicalServiceAnchor[] = [
    {
      center: residence.center,
      kind: 'RESIDENCE',
      radiusMeters: 24,
    },
  ];

  placements.forEach((placement) => {
    if (placement.status !== 'placed' || !placement.gridPosition) {
      return;
    }

    const id = placement.infrastructureId;

    switch (id) {
      // PROCESSAMENTO
      case 'viveiro-mudas':
        anchors.push({
          center: placement.gridPosition,
          influence: 'NURSERY',
          kind: 'PROCESSAMENTO',
          radiusMeters: 20,
        });
        break;
      case 'compostagem':
        anchors.push({
          center: placement.gridPosition,
          influence: 'FERTILITY',
          kind: 'PROCESSAMENTO',
          radiusMeters: 18,
        });
        break;

      // ANIMAL
      case 'aviario-movel':
        anchors.push({
          center: placement.gridPosition,
          influence: 'FERTILITY',
          kind: 'ANIMAL',
          radiusMeters: 25,
        });
        break;
      case 'apiario':
        anchors.push({
          center: placement.gridPosition,
          influence: 'POLLINATION',
          kind: 'ANIMAL',
          radiusMeters: 40,
        });
        break;

      // AGUA
      case 'lago-aquicultura':
        anchors.push({
          center: placement.gridPosition,
          influence: 'FERTIGATION',
          kind: 'AGUA',
          radiusMeters: 30,
        });
        break;

      // ENERGIA
      case 'biodigestor':
        anchors.push({
          center: placement.gridPosition,
          influence: 'FERTIGATION',
          kind: 'PROCESSAMENTO',
          radiusMeters: 22,
        });
        break;

      default:
        if (placement.category === 'PROCESSAMENTO') {
          anchors.push({
            center: placement.gridPosition,
            kind: 'PROCESSAMENTO',
            radiusMeters: 16,
          });
        }
        break;
    }
  });

  // Trace effluent corridors downhill from fertigation sources (lago, biodigestor)
  if (flowDirectionGrid && terrain) {
    const fertigationAnchors = anchors.filter((a) => a.influence === 'FERTIGATION');

    for (let i = 0; i < fertigationAnchors.length; i += 1) {
      const source = fertigationAnchors[i];
      const corridorAnchors = traceEffluentCorridor(
        source.center,
        flowDirectionGrid,
        terrain,
      );

      for (let j = 0; j < corridorAnchors.length; j += 1) {
        anchors.push(corridorAnchors[j]);
      }
    }
  }

  return anchors;
}

/**
 * Trace the downhill flow path from a fertigation source, creating smaller
 * FERTIGATION influence anchors along the corridor. Effluent nutrients
 * diminish with distance, so radius and influence shrink downstream.
 */
function traceEffluentCorridor(
  sourceGrid: GridCoordinate,
  flowDirectionGrid: Int8Array,
  terrain: ProceduralEngineInput['terrain'],
): BotanicalServiceAnchor[] {
  const anchors: BotanicalServiceAnchor[] = [];
  const maxSteps = 40; // limit trace length
  const anchorInterval = 8; // place an anchor every N cells
  let currentX = sourceGrid.x;
  let currentY = sourceGrid.y;
  const visited = new Set<number>();

  for (let step = 0; step < maxSteps; step += 1) {
    const index = currentY * terrain.gridWidth + currentX;

    if (visited.has(index)) {
      break; // cycle detected
    }

    visited.add(index);

    const direction = flowDirectionGrid[index];

    if (direction < 0 || direction > 7) {
      break; // sink or boundary
    }

    const offset = D8_OFFSETS[direction];
    const nextX = currentX + offset.x;
    const nextY = currentY + offset.y;

    if (nextX < 0 || nextX >= terrain.gridWidth || nextY < 0 || nextY >= terrain.gridHeight) {
      break;
    }

    currentX = nextX;
    currentY = nextY;

    // Place an anchor at regular intervals along the corridor
    if ((step + 1) % anchorInterval === 0) {
      // Nutrient concentration diminishes with distance: radius shrinks
      const distanceFactor = 1 - step / maxSteps;
      const radius = Math.max(6, Math.round(18 * distanceFactor));

      anchors.push({
        center: { x: currentX, y: currentY },
        influence: 'FERTIGATION',
        kind: 'AGUA',
        radiusMeters: radius,
      });
    }
  }

  return anchors;
}
