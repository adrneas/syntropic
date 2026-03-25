import {
  Droplets,
  Factory,
  Flower2,
  Home,
  type LucideIcon,
  PawPrint,
  Route,
  Shrub,
  SolarPanel,
  Spline,
  Sprout,
  TreeDeciduous,
  TreePine,
  Trees,
  Waves,
  Zap,
} from 'lucide-react';
import type { Stratum } from '../../core/types/botanical';
import type { LayoutGuideType, PlantManagementZone } from '../../core/types/generation';
import type { InfrastructureCategory } from '../../core/types/infrastructure';

export type ProjectVisualGroup = 'BASE' | 'GUIDES' | 'STRATA' | 'INFRA';

export type ProjectVisualTokenId =
  | 'residence'
  | 'solar-roof'
  | 'solar-ground'
  | 'guide-keyline'
  | 'guide-planting-row'
  | 'guide-interrow'
  | 'guide-service-corridor'
  | 'stratum-emergente'
  | 'stratum-alto'
  | 'stratum-medio'
  | 'stratum-baixo'
  | 'stratum-rasteiro'
  | 'infra-agua'
  | 'infra-animal'
  | 'infra-processamento'
  | 'infra-energia';

export interface ProjectVisualToken {
  color: string;
  group: ProjectVisualGroup;
  hint: string;
  icon: LucideIcon;
  id: ProjectVisualTokenId;
  label: string;
}

export const PROJECT_VISUAL_GROUP_LABELS: Record<ProjectVisualGroup, string> = {
  BASE: 'Estruturas Base',
  GUIDES: 'Guias Operacionais',
  INFRA: 'Infraestrutura',
  STRATA: 'Estratos Botanicos',
};

const PROJECT_VISUAL_TOKENS: Record<ProjectVisualTokenId, ProjectVisualToken> = {
  residence: {
    color: '#5b6676',
    group: 'BASE',
    hint: 'Polo habitacional e ponto base do sistema.',
    icon: Home,
    id: 'residence',
    label: 'Residencia',
  },
  'solar-roof': {
    color: '#2691c2',
    group: 'BASE',
    hint: 'Demanda solar absorvida pela cobertura.',
    icon: SolarPanel,
    id: 'solar-roof',
    label: 'Solar no telhado',
  },
  'solar-ground': {
    color: '#1e6f9b',
    group: 'BASE',
    hint: 'Complemento fotovoltaico alocado no solo.',
    icon: Zap,
    id: 'solar-ground',
    label: 'Solar em solo',
  },
  'guide-keyline': {
    color: '#0f766e',
    group: 'GUIDES',
    hint: 'Guia hidrologica principal do relevo.',
    icon: Spline,
    id: 'guide-keyline',
    label: 'Keyline',
  },
  'guide-planting-row': {
    color: '#5b9a57',
    group: 'GUIDES',
    hint: 'Linha principal de plantio do consorcio.',
    icon: Sprout,
    id: 'guide-planting-row',
    label: 'Linha de plantio',
  },
  'guide-interrow': {
    color: '#9fbf63',
    group: 'GUIDES',
    hint: 'Faixa produtiva e de cobertura entre linhas.',
    icon: Waves,
    id: 'guide-interrow',
    label: 'Entrelinha produtiva',
  },
  'guide-service-corridor': {
    color: '#d97706',
    group: 'GUIDES',
    hint: 'Corredor de acesso e manutencao operacional.',
    icon: Route,
    id: 'guide-service-corridor',
    label: 'Corredor operacional',
  },
  'stratum-emergente': {
    color: '#1f6d4d',
    group: 'STRATA',
    hint: 'Estrato estrutural de maior altura.',
    icon: TreePine,
    id: 'stratum-emergente',
    label: 'Emergente',
  },
  'stratum-alto': {
    color: '#2d8f57',
    group: 'STRATA',
    hint: 'Dossel alto de producao principal.',
    icon: Trees,
    id: 'stratum-alto',
    label: 'Alto',
  },
  'stratum-medio': {
    color: '#5aa05e',
    group: 'STRATA',
    hint: 'Fechamento intermediario de luz e volume.',
    icon: TreeDeciduous,
    id: 'stratum-medio',
    label: 'Medio',
  },
  'stratum-baixo': {
    color: '#8dbb61',
    group: 'STRATA',
    hint: 'Adensamento baixo de suporte e cobertura.',
    icon: Shrub,
    id: 'stratum-baixo',
    label: 'Baixo',
  },
  'stratum-rasteiro': {
    color: '#bfd97b',
    group: 'STRATA',
    hint: 'Cobertura rente ao solo e biomassa fina.',
    icon: Flower2,
    id: 'stratum-rasteiro',
    label: 'Rasteiro',
  },
  'infra-agua': {
    color: '#3b82c4',
    group: 'INFRA',
    hint: 'Modulos hidricos e de armazenamento.',
    icon: Droplets,
    id: 'infra-agua',
    label: 'Agua',
  },
  'infra-animal': {
    color: '#9a6b34',
    group: 'INFRA',
    hint: 'Infraestrutura zootecnica e de manejo animal.',
    icon: PawPrint,
    id: 'infra-animal',
    label: 'Animal',
  },
  'infra-processamento': {
    color: '#4f7f52',
    group: 'INFRA',
    hint: 'Modulos operacionais de processamento.',
    icon: Factory,
    id: 'infra-processamento',
    label: 'Processamento',
  },
  'infra-energia': {
    color: '#d97706',
    group: 'INFRA',
    hint: 'Infraestrutura energetica complementar.',
    icon: Zap,
    id: 'infra-energia',
    label: 'Energia',
  },
};

export function getProjectVisualToken(id: ProjectVisualTokenId): ProjectVisualToken {
  return PROJECT_VISUAL_TOKENS[id];
}

export function getGuideVisualToken(type: LayoutGuideType): ProjectVisualToken {
  switch (type) {
    case 'KEYLINE':
      return PROJECT_VISUAL_TOKENS['guide-keyline'];
    case 'PLANTING_ROW':
      return PROJECT_VISUAL_TOKENS['guide-planting-row'];
    case 'INTERROW':
      return PROJECT_VISUAL_TOKENS['guide-interrow'];
    case 'SERVICE_CORRIDOR':
      return PROJECT_VISUAL_TOKENS['guide-service-corridor'];
    default:
      return PROJECT_VISUAL_TOKENS['guide-planting-row'];
  }
}

export function getInfrastructureCategoryToken(
  category: InfrastructureCategory,
): ProjectVisualToken {
  switch (category) {
    case 'AGUA':
      return PROJECT_VISUAL_TOKENS['infra-agua'];
    case 'ANIMAL':
      return PROJECT_VISUAL_TOKENS['infra-animal'];
    case 'PROCESSAMENTO':
      return PROJECT_VISUAL_TOKENS['infra-processamento'];
    case 'ENERGIA':
      return PROJECT_VISUAL_TOKENS['infra-energia'];
    default:
      return PROJECT_VISUAL_TOKENS['infra-processamento'];
  }
}

export function getStratumVisualToken(stratum: Stratum): ProjectVisualToken {
  switch (stratum) {
    case 'EMERGENTE':
      return PROJECT_VISUAL_TOKENS['stratum-emergente'];
    case 'ALTO':
      return PROJECT_VISUAL_TOKENS['stratum-alto'];
    case 'MEDIO':
      return PROJECT_VISUAL_TOKENS['stratum-medio'];
    case 'BAIXO':
      return PROJECT_VISUAL_TOKENS['stratum-baixo'];
    case 'RASTEIRO':
      return PROJECT_VISUAL_TOKENS['stratum-rasteiro'];
    default:
      return PROJECT_VISUAL_TOKENS['stratum-medio'];
  }
}

export function getPlantVisualSubtitle(
  stratum: Stratum,
  managementZone: PlantManagementZone,
): string {
  const zoneLabel =
    managementZone === 'INTERROW' ? 'Entrelinha produtiva' : 'Linha principal';

  return `${getStratumVisualToken(stratum).label} / ${zoneLabel}`;
}

export function withAlpha(color: string, alphaHex: string): string {
  if (!color.startsWith('#') || color.length !== 7) {
    return color;
  }

  return `${color}${alphaHex}`;
}
