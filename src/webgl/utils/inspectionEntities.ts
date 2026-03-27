import * as THREE from 'three';
import {
  getGuideVisualToken,
  getInfrastructureCategoryToken,
  getPlantVisualSubtitle,
  getProductiveAreaVisualToken,
  getProjectVisualToken,
  getStratumVisualToken,
} from '../../components/project/projectVisualTokens';
import type {
  BotanicalPlacement,
  InfrastructurePlacement,
  LayoutGuide,
  ProductiveArea,
  ResidencePlacement,
  SolarPlacement,
} from '../../core/types/generation';
import type { ProjectHoverLabel, ProjectInspectionEntity } from '../sceneTypes';

export function buildGuideHoverLabel(guide: LayoutGuide, yOffset: number): ProjectHoverLabel {
  const token = getGuideVisualToken(guide.type);
  const position = getGuideMidpointPosition(guide, yOffset);

  return {
    id: guide.id,
    position,
    subtitle: `${Math.round(guide.length)}m de extensao`,
    title: token.label,
    visualTokenId: token.id,
  };
}

export function buildProductiveAreaHoverLabel(
  area: ProductiveArea,
  yOffset: number,
): ProjectHoverLabel {
  const token = getProductiveAreaVisualToken(area.type);

  return {
    id: area.id,
    position: [area.centroid.x, area.centroid.z + yOffset, area.centroid.y],
    subtitle: `${Math.round(area.areaSquareMeters)}m2 de cobertura`,
    title: token.label,
    visualTokenId: token.id,
  };
}

export function getGuideMidpointPosition(guide: LayoutGuide, yOffset: number): [number, number, number] {
  if (guide.points.length === 0) {
    return [0, yOffset, 0];
  }

  if (guide.points.length === 1) {
    const point = guide.points[0];
    return [point.x, point.z + yOffset, point.y];
  }

  const totalLength =
    guide.length > Number.EPSILON
      ? guide.length
      : guide.points.reduce((sum, point, index) => {
          if (index === 0) {
            return sum;
          }

          const previous = guide.points[index - 1];
          return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
        }, 0);
  const midpointDistance = totalLength / 2;
  let traversed = 0;

  for (let index = 1; index < guide.points.length; index += 1) {
    const previous = guide.points[index - 1];
    const current = guide.points[index];
    const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);

    if (segmentLength <= Number.EPSILON) {
      continue;
    }

    if (traversed + segmentLength >= midpointDistance) {
      const factor = (midpointDistance - traversed) / segmentLength;
      const x = THREE.MathUtils.lerp(previous.x, current.x, factor);
      const y = THREE.MathUtils.lerp(previous.y, current.y, factor);
      const z = THREE.MathUtils.lerp(previous.z, current.z, factor);

      return [x, z + yOffset, y];
    }

    traversed += segmentLength;
  }

  const fallbackPoint = guide.points[Math.floor(guide.points.length / 2)];
  return [fallbackPoint.x, fallbackPoint.z + yOffset, fallbackPoint.y];
}

export function buildResidenceInspectionEntity(residence: ResidencePlacement): ProjectInspectionEntity {
  return {
    id: 'residence',
    badge: getProjectVisualToken('residence').label,
    description:
      residence.requiredSolarArea > 0
        ? 'Residencia posicionada deterministicamente a partir do centroide e usada como base para o dimensionamento solar.'
        : 'Residencia posicionada deterministicamente a partir do centroide do poligono valido.',
    details: [
      { label: 'Pegada', value: `${residence.footprint.width}m x ${residence.footprint.length}m` },
      { label: 'Cota media', value: `${residence.elevation.toFixed(1)}m` },
      { label: 'Orientacao', value: `${Math.round((residence.rotationRadians * 180) / Math.PI)}deg` },
      { label: 'Solar requerido', value: `${residence.requiredSolarArea.toFixed(1)} m2` },
      { label: 'Solar no telhado', value: `${residence.roofSolarAreaUsed.toFixed(1)} / ${residence.roofSolarCapacityArea.toFixed(1)} m2` },
    ],
    title: 'Residencia Principal',
    visualTokenId: 'residence',
  };
}

export function buildRoofSolarInspectionEntity(residence: ResidencePlacement): ProjectInspectionEntity {
  return {
    id: 'solar-roof',
    badge: getProjectVisualToken('solar-roof').label,
    description:
      'Parte da demanda solar foi absorvida pela cobertura da residencia antes de ocupar area de solo.',
    details: [
      { label: 'Area requerida', value: `${residence.requiredSolarArea.toFixed(1)} m2` },
      { label: 'Area no telhado', value: `${residence.roofSolarAreaUsed.toFixed(1)} m2` },
      { label: 'Capacidade util', value: `${residence.roofSolarCapacityArea.toFixed(1)} m2` },
      { label: 'Orientacao', value: `${Math.round((residence.rotationRadians * 180) / Math.PI)}deg` },
    ],
    title: 'Painel Solar Integrado',
    visualTokenId: 'solar-roof',
  };
}

export function buildGroundSolarInspectionEntity(
  solar: SolarPlacement,
  residence: ResidencePlacement,
): ProjectInspectionEntity {
  return {
    id: 'solar-ground',
    badge: getProjectVisualToken('solar-ground').label,
    description:
      'Array fotovoltaico complementar alocado no terreno para absorver o excedente nao acomodado no telhado.',
    details: [
      { label: 'Pegada', value: `${solar.footprint.width}m x ${solar.footprint.length}m` },
      { label: 'Area provida', value: `${solar.providedArea.toFixed(1)} m2` },
      { label: 'Excedente apos telhado', value: `${Math.max(0, residence.requiredSolarArea - residence.roofSolarAreaUsed).toFixed(1)} m2` },
      { label: 'Cota media', value: `${solar.elevation.toFixed(1)}m` },
      { label: 'Orientacao', value: `${Math.round((solar.rotationRadians * 180) / Math.PI)}deg` },
    ],
    title: 'Array Fotovoltaico Complementar',
    visualTokenId: 'solar-ground',
  };
}

export function buildInfrastructureInspectionEntity(
  placement: InfrastructurePlacement & {
    category: NonNullable<InfrastructurePlacement['category']>;
    footprint: NonNullable<InfrastructurePlacement['footprint']>;
    worldPosition: NonNullable<InfrastructurePlacement['worldPosition']>;
  },
): ProjectInspectionEntity {
  const token = getInfrastructureCategoryToken(placement.category);

  return {
    id: `infra-${placement.infrastructureId}`,
    badge: token.label,
    description: placement.rationale,
    details: [
      { label: 'Pegada', value: `${placement.footprint.width}m x ${placement.footprint.length}m` },
      { label: 'Posicao', value: `x ${placement.worldPosition.x.toFixed(1)} / y ${placement.worldPosition.y.toFixed(1)}` },
      { label: 'Cota media', value: `${placement.worldPosition.z.toFixed(1)}m` },
      { label: 'Status', value: placement.status },
    ],
    title: placement.name,
    visualTokenId: token.id,
  };
}

export function buildProductiveAreaInspectionEntity(area: ProductiveArea): ProjectInspectionEntity {
  const token = getProductiveAreaVisualToken(area.type);

  return {
    id: `area-${area.id}`,
    badge: token.label,
    description:
      area.type === 'TOPO_CREST'
        ? 'Area poligonal aplicada nas cotas mais altas e estaveis, suavizada sobre a topografia para fechar os topos de elevacao com malha produtiva.'
        : area.type === 'FLAT_PRODUCTIVE'
          ? 'Area plana e util posicionada ao redor das construcoes para absorver os vazios produtivos sem deixar sobras operacionais.'
          : area.type === 'SLOPE_PRODUCTIVE'
            ? 'Area cultivavel em encosta, distribuida como malha sobre o declive para acompanhar a topografia sem deixar a vertente vazia.'
          : 'Area residual usada para conectar a malha produtiva e eliminar pedacos mortos entre restricoes, corredores e volumes construidos.',
    details: [
      { label: 'Tipo', value: token.label },
      { label: 'Area util', value: `${area.areaSquareMeters.toFixed(1)} m2` },
      { label: 'Cota media', value: `${area.averageElevation.toFixed(1)}m` },
      { label: 'Declive medio', value: `${area.averageSlopePercent.toFixed(1)}%` },
      { label: 'Centro', value: `x ${area.centroid.x.toFixed(1)} / y ${area.centroid.y.toFixed(1)}` },
    ],
    title: token.label,
    visualTokenId: token.id,
  };
}

export function buildPlantInspectionEntity(plant: BotanicalPlacement): ProjectInspectionEntity {
  const token = getStratumVisualToken(plant.stratum);
  const productiveAreaLabel = getProductiveAreaLabel(plant.productiveAreaType);

  return {
    id: plant.id,
    badge: getPlantVisualSubtitle(plant.stratum, plant.managementZone),
    description: buildPlantDescription(plant),
    details: [
      { label: 'Nome cientifico', value: plant.scientificName },
      { label: 'Area base', value: productiveAreaLabel },
      { label: 'Manejo', value: plant.managementZone === 'INTERROW' ? 'Entrelinha produtiva' : 'Malha principal' },
      { label: 'Perfil', value: plant.managementProfile },
      { label: 'Faixa operacional', value: plant.operationalBand },
      { label: 'Ciclo', value: `${plant.maintenanceCycleDays} dias` },
      { label: 'Sucessao', value: plant.succession },
      { label: 'Agua', value: plant.waterRequirement },
      { label: 'Escala', value: `${plant.scale.toFixed(2)}x` },
      { label: 'Companheiras', value: plant.companions.length ? plant.companions.join(', ') : 'nenhuma' },
      { label: 'Antagonistas', value: plant.antagonists.length ? plant.antagonists.join(', ') : 'nenhum' },
    ],
    title: plant.popularName,
    visualTokenId: token.id,
  };
}

export function getInfrastructureColor(category: NonNullable<InfrastructurePlacement['category']>, isSelected: boolean): string {
  if (isSelected) {
    return '#1769aa';
  }

  return getInfrastructureCategoryToken(category).color;
}

export function getInfrastructureHeight(category: NonNullable<InfrastructurePlacement['category']>): number {
  switch (category) {
    case 'AGUA':
      return 1.2;
    case 'ENERGIA':
      return 1.4;
    case 'ANIMAL':
      return 1.8;
    case 'PROCESSAMENTO':
      return 1.6;
    default:
      return 1.5;
  }
}

export function getPlantVisualRadius(plant: BotanicalPlacement): number {
  const baseRadius = plant.canopyRadius * plant.scale;
  const zoneFactor = plant.managementZone === 'INTERROW' ? 0.82 : 1;

  switch (plant.stratum) {
    case 'EMERGENTE':
      return baseRadius * 1.2 * zoneFactor;
    case 'ALTO':
      return baseRadius * 1.05 * zoneFactor;
    case 'MEDIO':
      return baseRadius * 0.95 * zoneFactor;
    case 'BAIXO':
      return baseRadius * 0.8 * zoneFactor;
    case 'RASTEIRO':
      return Math.max(0.22, baseRadius * 0.65 * zoneFactor);
    default:
      return baseRadius * zoneFactor;
  }
}

export function getStratumColor(
  stratum: BotanicalPlacement['stratum'],
  isSelected: boolean,
  managementZone: BotanicalPlacement['managementZone'] = 'ROW',
): string {
  if (isSelected) {
    return '#0f766e';
  }

  const baseColor = getStratumVisualToken(stratum).color;

  if (managementZone === 'INTERROW') {
    switch (stratum) {
      case 'BAIXO':
        return '#a8c66c';
      case 'RASTEIRO':
        return '#d6e68a';
      default:
        return baseColor;
    }
  }

  return baseColor;
}

export function buildPlantDescription(plant: BotanicalPlacement): string {
  if (plant.productiveAreaType === 'FLAT_PRODUCTIVE') {
    return plant.managementProfile === 'MOWED_ACCESS'
      ? 'Especie alocada em area plana proxima a infraestrutura, mantida baixa para preservar acesso, visibilidade e operacao.'
      : 'Especie alocada em area plana produtiva ao redor das construcoes, priorizando fechamento de solo e uso intensivo sem sobra espacial.';
  }

  if (plant.productiveAreaType === 'TOPO_CREST') {
    return 'Especie posicionada sobre uma malha de topo, acompanhando as cotas mais altas do relevo com ocupacao estratificada e suave.';
  }

  if (plant.productiveAreaType === 'SLOPE_PRODUCTIVE') {
    return 'Especie alocada em encosta cultivavel, organizada em faixas a partir dos swales para acompanhar o declive, infiltrar agua e evitar vazios na vertente.';
  }

  if (plant.managementZone === 'INTERROW') {
    if (plant.managementProfile === 'MOWED_ACCESS') {
      return 'Especie de cobertura mantida baixa em faixa de servico, priorizando acesso, visibilidade e manutencao frequente perto da casa ou dos modulos operacionais.';
    }

    if (plant.managementProfile === 'MULCH_RETENTION') {
      return 'Especie de entrelinha voltada a cobertura persistente e retencao de mulch, adequada para reduzir evaporacao e proteger o solo em condicoes mais secas.';
    }

    if (plant.managementProfile === 'WINTER_COVER') {
      return 'Especie de entrelinha usada como cobertura sazonal, sustentando biomassa e protecao do solo em regime subtropical ou temperado.';
    }

    return 'Especie de cobertura e biomassa alocada na entrelinha para fechar solo, aportar materia organica e manter a faixa produtiva sem adensamento arboreo.';
  }

  switch (plant.stratum) {
    case 'EMERGENTE':
      return 'Elemento estrutural de estrato emergente, usado para abrir altura e acelerar biomassa no consorcio.';
    case 'ALTO':
      return 'Esp\u00e9cie de estrato alto posicionada para preencher o dossel produtivo principal sobre a linha.';
    case 'MEDIO':
      return 'Esp\u00e9cie de estrato m\u00e9dio inserida para densificar a sucessao e ocupar lacunas intermediarias de luz.';
    case 'BAIXO':
      return 'Esp\u00e9cie de estrato baixo usada para adensar a linha e sustentar a cobertura produtiva inicial.';
    case 'RASTEIRO':
      return 'Esp\u00e9cie rasteira usada para fechar o solo, reduzir exposi\u00e7\u00e3o e completar a ocupa\u00e7\u00e3o do consorcio.';
    default:
      return 'Esp\u00e9cie alocada deterministicamente sobre a linha de plantio.';
  }
}

export function getProductiveAreaLabel(type: BotanicalPlacement['productiveAreaType']): string {
  switch (type) {
    case 'TOPO_CREST':
      return 'Topo de elevacao';
    case 'FLAT_PRODUCTIVE':
      return 'Area plana produtiva';
    case 'SLOPE_PRODUCTIVE':
      return 'Encosta produtiva';
    case 'GENERAL_FILL':
    default:
      return 'Preenchimento residual';
  }
}
