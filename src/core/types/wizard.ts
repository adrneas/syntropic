export type GenerationStatus = 'idle' | 'processing' | 'completed';
export type ViewMode = '2D' | '3D';
export type ToolMode = 'select' | 'draw' | 'elevation';

export interface IWizardState {
  currentStep: number; // 1 a 5
  viewMode: ViewMode;
  toolMode: ToolMode;
  brushSize: number; // Raio do pincel de altimetria
  terrain: {
    polygon: Array<{x: number, y: number}>;
    area: number; // em m²
    northAngle: number; // 0 a 360 graus
    elevationGrid: Float32Array | null; // Estado da malha altimétrica
  };
  residence: {
    area: number; // em m²
    appliances: Record<string, number>; // { "chuveiro": 1, "geladeira": 2 }
    calculatedSolarNeed: number; // em kWh/mês (Calculado em tempo real)
  };
  climate: string; // ID do clima selecionado
  preferences: {
    infrastructure: Array<string>; // IDs das estruturas selecionadas
  };
  generationStatus: GenerationStatus;
}
