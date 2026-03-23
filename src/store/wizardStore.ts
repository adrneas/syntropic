import { create } from 'zustand';
import { IWizardState } from '../core/types/wizard';

interface WizardStore extends IWizardState {
  // Navigation actions
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  
  // Terrain actions
  updateTerrainPolygon: (polygon: Array<{x: number, y: number}>, area: number) => void;
  updateNorthAngle: (angle: number) => void;
  updateElevationGrid: (grid: Float32Array) => void;

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

const initialState: IWizardState = {
  currentStep: 1,
  terrain: {
    polygon: [],
    area: 0,
    northAngle: 0,
    elevationGrid: null,
  },
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

export const useWizardStore = create<WizardStore>((set, get) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),
  nextStep: () => set((state) => ({ currentStep: Math.min(state.currentStep + 1, 5) })),
  prevStep: () => set((state) => ({ currentStep: Math.max(state.currentStep - 1, 1) })),

  updateTerrainPolygon: (polygon, area) => set((state) => ({
    terrain: { ...state.terrain, polygon, area }
  })),
  
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
