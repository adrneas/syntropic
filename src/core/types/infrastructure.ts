export type InfrastructureCategory = 'AGUA' | 'ENERGIA' | 'ANIMAL' | 'PROCESSAMENTO';
export type ProximityRule = 'NEAR' | 'FAR' | 'ANY';
export type TopographyPreference = 'LOWEST' | 'HIGHEST' | 'MID' | 'STABLE';

export interface IInfrastructure {
  id: string; // ex: "cisterna-ferrocimento"
  name: string; // ex: "Cisterna de Ferrocimento"
  category: InfrastructureCategory;
  footprintWidth: number; // Ocupacao em X na grade (metros)
  footprintLength: number; // Ocupacao em Y na grade (metros)

  // IDs de infraestruturas que devem ficar próximas (cadeia produtiva)
  preferredNearInfrastructure?: string[];

  // Regras de posicionamento para o motor procedural
  placementRules: {
    requiresKeyline: boolean;
    maxSlopePercentage: number; // Inclinacao media preferencial para instalacao
    maxCriticalSlopePercentage: number; // Teto absoluto para celulas pontualmente mais inclinadas
    maxCriticalCellRatio: number; // Percentual da pegada que pode ultrapassar a inclinacao preferencial
    maxAltitudeVariationMeters: number; // Variacao total de cota tolerada na pegada via fundacao
    proximityToResidence: ProximityRule;
    preferredDistanceMinMeters?: number;
    preferredDistanceMaxMeters?: number;
    topographyPreference: TopographyPreference;
  };
}
