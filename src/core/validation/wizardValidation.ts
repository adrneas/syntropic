import type { IWizardState } from '../types/wizard';

export interface StepValidation {
  canAdvance: boolean;
  message: string;
}

interface StepValidationInput {
  climate: IWizardState['climate'];
  currentStep: number;
  generationStatus: IWizardState['generationStatus'];
  residenceArea: number;
  terrainArea: number;
  terrainPolygonLength: number;
}

export function getCurrentStepValidation(state: IWizardState): StepValidation {
  return getStepValidation({
    climate: state.climate,
    currentStep: state.currentStep,
    generationStatus: state.generationStatus,
    residenceArea: state.residence.area,
    terrainArea: state.terrain.area,
    terrainPolygonLength: state.terrain.polygon.length,
  });
}

export function getStepValidation(input: StepValidationInput): StepValidation {
  switch (input.currentStep) {
    case 1:
      return input.terrainPolygonLength >= 3 && input.terrainArea > 0
        ? { canAdvance: true, message: 'Terreno valido.' }
        : { canAdvance: false, message: 'Defina um poligono de terreno valido antes de avancar.' };
    case 2:
      return input.residenceArea > 0
        ? { canAdvance: true, message: 'Residencia definida.' }
        : { canAdvance: false, message: 'Informe a area da residencia.' };
    case 3:
      return input.climate
        ? { canAdvance: true, message: 'Clima definido.' }
        : { canAdvance: false, message: 'Selecione um clima para continuar.' };
    case 4:
      return { canAdvance: true, message: 'Preferencias opcionais prontas.' };
    case 5:
      return canGenerateProjectFromInput(input)
        ? { canAdvance: true, message: 'Parametros prontos para geracao.' }
        : { canAdvance: false, message: 'Revise as etapas anteriores antes de gerar.' };
    default:
      return { canAdvance: false, message: 'Etapa desconhecida.' };
  }
}

export function canGenerateProject(state: IWizardState): boolean {
  return canGenerateProjectFromInput({
    climate: state.climate,
    currentStep: state.currentStep,
    generationStatus: state.generationStatus,
    residenceArea: state.residence.area,
    terrainArea: state.terrain.area,
    terrainPolygonLength: state.terrain.polygon.length,
  });
}

function canGenerateProjectFromInput(input: StepValidationInput): boolean {
  return (
    input.terrainPolygonLength >= 3 &&
    input.terrainArea > 0 &&
    input.residenceArea > 0 &&
    Boolean(input.climate) &&
    input.generationStatus !== 'processing'
  );
}
