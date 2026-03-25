import type { GeneratedProject } from './generation';
import type { TerrainState } from './terrain';
import type { ClimateZone } from './botanical';

export type GenerationStatus = 'idle' | 'processing' | 'completed' | 'error';
export type ViewMode = '2D' | '3D';
export type ToolMode = 'select' | 'draw' | 'elevation';

export interface IWizardState {
  currentStep: number;
  viewMode: ViewMode;
  toolMode: ToolMode;
  brushSize: number;
  terrain: TerrainState;
  residence: {
    area: number;
    appliances: Record<string, number>;
    calculatedSolarNeed: number;
  };
  climate: ClimateZone | '';
  preferences: {
    infrastructure: string[];
  };
  generationStatus: GenerationStatus;
  generatedProject: GeneratedProject | null;
  generationError: string | null;
}
