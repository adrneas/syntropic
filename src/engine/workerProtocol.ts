import type { GeneratedProject } from '../core/types/generation';
import type { ProceduralEngineInput } from './types';

export interface ProceduralEngineRequestMessage {
  input: ProceduralEngineInput;
  requestId: string;
  type: 'generate';
}

export interface ProceduralEngineSuccessMessage {
  project: GeneratedProject;
  requestId: string;
  type: 'success';
}

export interface ProceduralEngineErrorMessage {
  error: string;
  requestId: string;
  type: 'error';
}

export type ProceduralEngineWorkerMessage =
  | ProceduralEngineSuccessMessage
  | ProceduralEngineErrorMessage;
