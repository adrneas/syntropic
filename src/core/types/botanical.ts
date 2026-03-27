export type Stratum = 'EMERGENTE' | 'ALTO' | 'MEDIO' | 'BAIXO' | 'RASTEIRO';
export type SuccessionPhase = 'PLACENTA_I' | 'PLACENTA_II' | 'SECUNDARIA_I' | 'SECUNDARIA_II' | 'CLIMAX';
export type ClimateZone = 'TROPICAL_UMIDO' | 'TROPICAL_SECO' | 'SEMIARIDO' | 'TEMPERADO' | 'SUBTROPICAL';

export interface ISpecies {
  id: string;             // ex: "eucalyptus-grandis"
  popularName: string;    // ex: "Eucalipto"
  scientificName: string; // ex: "Eucalyptus grandis"
  stratum: Stratum;
  succession: SuccessionPhase;
  climateCompatibility: ClimateZone[]; // Climas onde a planta sobrevive
  waterRequirement: 'LOW' | 'MEDIUM' | 'HIGH';
  spacingArea: number;    // Área de projeção da copa/raiz em m² (determina a malha de colisão)
  nitrogenFixer: boolean; // Espécie fixadora de nitrogênio (leguminosas, etc.)

  // Matriz Lógica de Consórcio
  companions: string[];   // Array de IDs de espécies benéficas (simbiose)
  antagonists: string[];  // Array de IDs de espécies incompatíveis (alelopatia)
}
