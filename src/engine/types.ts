import type { IWizardState } from '../core/types/wizard';

export type ProceduralEngineInput = Pick<IWizardState, 'terrain' | 'residence' | 'climate' | 'preferences'>;
