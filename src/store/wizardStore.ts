import { create } from 'zustand';
import type { IWizardState, ViewMode, ToolMode } from '../core/types/wizard';

interface WizardStore extends IWizardState {
  // Navigation actions
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  
  // UI Layer actions
  setViewMode: (mode: ViewMode) => void;
  setToolMode: (mode: ToolMode) => void;
  setBrushSize: (size: number) => void;
  
  // Terrain actions
  updateTerrainPolygon: (polygon: Array<{x: number, y: number}>, area: number) => void;
  undoTerrainPolygon: () => void;
  redoTerrainPolygon: () => void;
  updateNorthAngle: (angle: number) => void;
  updateElevationGrid: (grid: Float32Array) => void;

  // History state for UI buttons
  history: {
    past: Array<Array<{x: number, y: number}>>;
    future: Array<Array<{x: number, y: number}>>;
  };

  // Residence actions
  updateResidenceArea: (area: number) => void;
  updateAppliance: (id: string, quantity: number) => void;
  calculateSolarNeed: () => void; // Internal or triggered externally
  
  // Climate & Preferences
  setClimate: (climateId: string) => void;
  toggleInfrastructure: (infraId: string) => void;

  // Generation
  setGenerationStatus: (status: IWizardState['generationStatus']) => void;
  resetWizard: () => void;
}

const initialState: IWizardState & { history: { past: any[], future: any[] } } = {
  currentStep: 1,
  viewMode: '3D',
  toolMode: 'select',
  brushSize: 10, // Default 10m
  terrain: {
    polygon: [],
    area: 0,
    northAngle: 0,
    elevationGrid: null,
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
};

// Appliance power definitions for real-time solar calculation
const APPLIANCES_DATA: Record<string, { powerW: number; hoursPerDay: number }> = {
  'chuveiro': { powerW: 5500, hoursPerDay: 0.5 },
  'ar-condicionado': { powerW: 1500, hoursPerDay: 8 },
  'geladeira': { powerW: 250, hoursPerDay: 24 },
  'computador': { powerW: 150, hoursPerDay: 8 },
};

export const useWizardStore = create<WizardStore>((set) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),
  nextStep: () => set((state) => ({ currentStep: Math.min(state.currentStep + 1, 5) })),
  prevStep: () => set((state) => ({ currentStep: Math.max(state.currentStep - 1, 1) })),

  setViewMode: (mode) => set({ viewMode: mode }),
  setToolMode: (mode) => set({ toolMode: mode }),
  setBrushSize: (size) => set({ brushSize: size }),

  updateTerrainPolygon: (polygon, area) => set((state) => ({
    terrain: { ...state.terrain, polygon, area },
    history: {
      past: [...state.history.past, state.terrain.polygon],
      future: [] // clear future on new action
    }
  })),

  undoTerrainPolygon: () => set((state) => {
    if (state.history.past.length === 0) return state;
    const previous = state.history.past[state.history.past.length - 1];
    const newPast = state.history.past.slice(0, -1);
    
    return {
      terrain: { ...state.terrain, polygon: previous },
      history: {
        past: newPast,
        future: [state.terrain.polygon, ...state.history.future]
      }
    };
  }),

  redoTerrainPolygon: () => set((state) => {
    if (state.history.future.length === 0) return state;
    const next = state.history.future[0];
    const newFuture = state.history.future.slice(1);

    return {
      terrain: { ...state.terrain, polygon: next },
      history: {
        past: [...state.history.past, state.terrain.polygon],
        future: newFuture
      }
    };
  }),
  
  updateNorthAngle: (angle) => set((state) => ({
    terrain: { ...state.terrain, northAngle: angle }
  })),

  updateElevationGrid: (grid) => set((state) => ({
    terrain: { ...state.terrain, elevationGrid: grid }
  })),

  updateResidenceArea: (area) => set((state) => ({
    residence: { ...state.residence, area }
  })),

  updateAppliance: (id, quantity) => set((state) => {
    const newAppliances = { ...state.residence.appliances };
    if (quantity <= 0) {
      delete newAppliances[id];
    } else {
      newAppliances[id] = quantity;
    }
    return {
      residence: { ...state.residence, appliances: newAppliances }
    };
  }),

  calculateSolarNeed: () => set((state) => {
    let totalKWhMonth = 0;
    const { appliances } = state.residence;
    
    Object.entries(appliances).forEach(([id, quantity]) => {
      const data = APPLIANCES_DATA[id];
      if (data) {
        // (W * h/day * 30 days) / 1000 = kWh/month
        const dailyWh = data.powerW * data.hoursPerDay * quantity;
        totalKWhMonth += (dailyWh * 30) / 1000;
      }
    });

    return {
      residence: { ...state.residence, calculatedSolarNeed: Math.round(totalKWhMonth * 10) / 10 }
    };
  }),

  setClimate: (climateId) => set({ climate: climateId }),

  toggleInfrastructure: (infraId) => set((state) => {
    const isSelected = state.preferences.infrastructure.includes(infraId);
    return {
      preferences: {
        ...state.preferences,
        infrastructure: isSelected
          ? state.preferences.infrastructure.filter(id => id !== infraId)
          : [...state.preferences.infrastructure, infraId]
      }
    };
  }),

  setGenerationStatus: (status) => set({ generationStatus: status }),

  resetWizard: () => set(initialState),
}));
