import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GeneratedProject } from '../core/types/generation';
import type { TerrainPoint } from '../core/types/terrain';
import type { IWizardState, ToolMode, ViewMode } from '../core/types/wizard';
import {
  calculatePolygonArea,
  computeAdaptiveGrid,
  createFlatElevationGrid,
  DEFAULT_TERRAIN_CELL_SIZE,
  DEFAULT_TERRAIN_GRID_HEIGHT,
  DEFAULT_TERRAIN_GRID_WIDTH,
} from '../core/utils/terrain';
import { typedArrayReplacer, typedArrayReviver } from './persistence';

interface WizardStore extends IWizardState {
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setViewMode: (mode: ViewMode) => void;
  setToolMode: (mode: ToolMode) => void;
  setBrushSize: (size: number) => void;
  updateTerrainPolygon: (polygon: TerrainPoint[]) => void;
  replaceTerrainPolygon: (polygon: TerrainPoint[]) => void;
  commitTerrainPolygonHistory: (previousPolygon: TerrainPoint[]) => void;
  undoTerrainPolygon: () => void;
  redoTerrainPolygon: () => void;
  updateNorthAngle: (angle: number) => void;
  updateElevationGrid: (grid: Float32Array) => void;
  clearTerrain: () => void;
  history: {
    past: TerrainPoint[][];
    future: TerrainPoint[][];
  };
  updateResidenceArea: (area: number) => void;
  updateAppliance: (id: string, quantity: number) => void;
  setClimate: (climateId: IWizardState['climate']) => void;
  toggleInfrastructure: (infraId: string) => void;
  setGenerationStatus: (status: IWizardState['generationStatus']) => void;
  setGeneratedProject: (project: GeneratedProject | null) => void;
  setGenerationError: (error: string | null) => void;
  beginEditingProject: () => void;
  resetWizard: () => void;
}

type PersistedWizardState = Pick<
  WizardStore,
  | 'brushSize'
  | 'climate'
  | 'currentStep'
  | 'history'
  | 'preferences'
  | 'residence'
  | 'terrain'
  | 'toolMode'
  | 'viewMode'
>;

const WIZARD_STORAGE_KEY = 'ssi-wizard-state';

const APPLIANCES_DATA: Record<string, { powerW: number; hoursPerDay: number }> = {
  chuveiro: { powerW: 5500, hoursPerDay: 0.5 },
  'ar-condicionado': { powerW: 1500, hoursPerDay: 8 },
  geladeira: { powerW: 250, hoursPerDay: 24 },
  computador: { powerW: 150, hoursPerDay: 8 },
};

function createInitialState(): IWizardState & { history: WizardStore['history'] } {
  return {
    currentStep: 1,
    viewMode: '2D',
    toolMode: 'select',
    brushSize: 10,
    terrain: {
      polygon: [],
      area: 0,
      northAngle: 0,
      gridWidth: DEFAULT_TERRAIN_GRID_WIDTH,
      gridHeight: DEFAULT_TERRAIN_GRID_HEIGHT,
      cellSize: DEFAULT_TERRAIN_CELL_SIZE,
      elevationGrid: createFlatElevationGrid(),
    },
    history: { past: [], future: [] },
    residence: {
      area: 0,
      appliances: {},
      calculatedSolarNeed: 0,
    },
    climate: '',
    preferences: {
      infrastructure: [],
    },
    generationStatus: 'idle',
    generatedProject: null,
    generationError: null,
  };
}

function calculateSolarNeed(appliances: Record<string, number>): number {
  let totalKWhMonth = 0;

  Object.entries(appliances).forEach(([id, quantity]) => {
    const data = APPLIANCES_DATA[id];

    if (!data) {
      return;
    }

    totalKWhMonth += ((data.powerW * data.hoursPerDay * quantity) * 30) / 1000;
  });

  return Math.round(totalKWhMonth * 10) / 10;
}

function resetGeneration<T extends object>(partialState: T): T & Pick<WizardStore, 'generationStatus' | 'generatedProject' | 'generationError'> {
  return {
    ...partialState,
    generationStatus: 'idle',
    generatedProject: null,
    generationError: null,
  };
}

export const useWizardStore = create<WizardStore>()(
  persist(
    (set) => ({
      ...createInitialState(),

      setStep: (step) => set({ currentStep: step }),
      nextStep: () => set((state) => ({ currentStep: Math.min(state.currentStep + 1, 5) })),
      prevStep: () => set((state) => ({ currentStep: Math.max(state.currentStep - 1, 1) })),

      setViewMode: (mode) => set({ viewMode: mode }),
      setToolMode: (mode) => set({ toolMode: mode }),
      setBrushSize: (size) => set({ brushSize: size }),

      updateTerrainPolygon: (polygon) => set((state) => {
        const adaptive = computeAdaptiveGrid(polygon);
        const gridChanged =
          adaptive.gridWidth !== state.terrain.gridWidth ||
          adaptive.gridHeight !== state.terrain.gridHeight ||
          adaptive.cellSize !== state.terrain.cellSize;

        return resetGeneration({
          terrain: {
            ...state.terrain,
            polygon,
            area: calculatePolygonArea(polygon),
            ...adaptive,
            elevationGrid: gridChanged
              ? createFlatElevationGrid(adaptive.gridWidth, adaptive.gridHeight)
              : state.terrain.elevationGrid,
          },
          history: {
            past: [...state.history.past, state.terrain.polygon],
            future: [],
          },
        });
      }),

      replaceTerrainPolygon: (polygon) => set((state) => {
        const adaptive = computeAdaptiveGrid(polygon);
        const gridChanged =
          adaptive.gridWidth !== state.terrain.gridWidth ||
          adaptive.gridHeight !== state.terrain.gridHeight ||
          adaptive.cellSize !== state.terrain.cellSize;

        return resetGeneration({
          terrain: {
            ...state.terrain,
            polygon,
            area: calculatePolygonArea(polygon),
            ...adaptive,
            elevationGrid: gridChanged
              ? createFlatElevationGrid(adaptive.gridWidth, adaptive.gridHeight)
              : state.terrain.elevationGrid,
          },
        });
      }),

      commitTerrainPolygonHistory: (previousPolygon) => set((state) => ({
        history: {
          past: [...state.history.past, previousPolygon],
          future: [],
        },
      })),

      undoTerrainPolygon: () => set((state) => {
        if (state.history.past.length === 0) {
          return state;
        }

        const previousPolygon = state.history.past[state.history.past.length - 1];
        const adaptive = computeAdaptiveGrid(previousPolygon);

        return resetGeneration({
          terrain: {
            ...state.terrain,
            polygon: previousPolygon,
            area: calculatePolygonArea(previousPolygon),
            ...adaptive,
            elevationGrid: createFlatElevationGrid(adaptive.gridWidth, adaptive.gridHeight),
          },
          history: {
            past: state.history.past.slice(0, -1),
            future: [state.terrain.polygon, ...state.history.future],
          },
        });
      }),

      redoTerrainPolygon: () => set((state) => {
        if (state.history.future.length === 0) {
          return state;
        }

        const nextPolygon = state.history.future[0];
        const adaptive = computeAdaptiveGrid(nextPolygon);

        return resetGeneration({
          terrain: {
            ...state.terrain,
            polygon: nextPolygon,
            area: calculatePolygonArea(nextPolygon),
            ...adaptive,
            elevationGrid: createFlatElevationGrid(adaptive.gridWidth, adaptive.gridHeight),
          },
          history: {
            past: [...state.history.past, state.terrain.polygon],
            future: state.history.future.slice(1),
          },
        });
      }),

      updateNorthAngle: (angle) => set((state) =>
        resetGeneration({
          terrain: {
            ...state.terrain,
            northAngle: angle,
          },
        }),
      ),

      updateElevationGrid: (grid) => set((state) =>
        resetGeneration({
          terrain: {
            ...state.terrain,
            elevationGrid: grid,
          },
        }),
      ),

      clearTerrain: () => set((state) =>
        resetGeneration({
          terrain: {
            ...state.terrain,
            polygon: [],
            area: 0,
            northAngle: 0,
            elevationGrid: createFlatElevationGrid(state.terrain.gridWidth, state.terrain.gridHeight),
          },
          history: { past: [], future: [] },
        }),
      ),

      updateResidenceArea: (area) => set((state) =>
        resetGeneration({
          residence: {
            ...state.residence,
            area: Math.max(0, area),
          },
        }),
      ),

      updateAppliance: (id, quantity) => set((state) => {
        const nextAppliances = { ...state.residence.appliances };

        if (quantity <= 0) {
          delete nextAppliances[id];
        } else {
          nextAppliances[id] = quantity;
        }

        return resetGeneration({
          residence: {
            ...state.residence,
            appliances: nextAppliances,
            calculatedSolarNeed: calculateSolarNeed(nextAppliances),
          },
        });
      }),

      setClimate: (climateId) => set(resetGeneration({ climate: climateId })),

      toggleInfrastructure: (infraId) => set((state) => {
        const alreadySelected = state.preferences.infrastructure.includes(infraId);

        return resetGeneration({
          preferences: {
            ...state.preferences,
            infrastructure: alreadySelected
              ? state.preferences.infrastructure.filter((currentId) => currentId !== infraId)
              : [...state.preferences.infrastructure, infraId],
          },
        });
      }),

      setGenerationStatus: (status) => set({ generationStatus: status }),
      setGeneratedProject: (project) => set({ generatedProject: project }),
      setGenerationError: (error) => set({ generationError: error }),
      beginEditingProject: () => set((state) => ({
        currentStep: 1,
        generationError: null,
        generatedProject: null,
        generationStatus: 'idle',
        toolMode: 'select',
        viewMode: state.viewMode === '3D' ? '3D' : '2D',
      })),

      resetWizard: () => set(createInitialState()),
    }),
    {
      name: WIZARD_STORAGE_KEY,
      partialize: (state): PersistedWizardState => ({
        brushSize: state.brushSize,
        climate: state.climate,
        currentStep: state.currentStep,
        history: state.history,
        preferences: state.preferences,
        residence: state.residence,
        terrain: state.terrain,
        toolMode: state.toolMode,
        viewMode: state.viewMode,
      }),
      storage: createJSONStorage(() => localStorage, {
        replacer: typedArrayReplacer,
        reviver: typedArrayReviver,
      }),
    },
  ),
);
