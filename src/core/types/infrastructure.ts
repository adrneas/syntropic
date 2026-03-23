export type InfrastructureCategory = 'AGUA' | 'ENERGIA' | 'ANIMAL' | 'PROCESSAMENTO';
export type ProximityRule = 'NEAR' | 'FAR' | 'ANY';

export interface IInfrastructure {
  id: string;               // ex: "cisterna-ferrocimento"
  name: string;             // ex: "Cisterna de Ferrocimento"
  category: InfrastructureCategory;
  footprintWidth: number;   // Ocupação em X na grade (metros)
  footprintLength: number;  // Ocupação em Y na grade (metros)
  
  // Regras de Posicionamento para o Motor Procedural
  placementRules: {
    requiresKeyline: boolean;      // Precisa estar em uma linha de convergência de água?
    maxSlopePercentage: number;    // Inclinação máxima permitida para instalação
    proximityToResidence: ProximityRule; // NEAR = < 50m, FAR = > 100m
  };
}
