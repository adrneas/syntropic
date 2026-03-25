import type { GeneratedProject } from '../core/types/generation';
import type { ProceduralEngineInput } from './types';
import { generateProjectCore } from './proceduralEngineCore';
import type {
  ProceduralEngineRequestMessage,
  ProceduralEngineWorkerMessage,
} from './workerProtocol';

export async function runProceduralEngine(input: ProceduralEngineInput): Promise<GeneratedProject> {
  if (typeof Worker === 'undefined') {
    return generateProjectCore(input);
  }

  const workerInput = cloneWorkerInput(input);

  return new Promise<GeneratedProject>((resolve, reject) => {
    const requestId = createRequestId();
    const worker = new Worker(new URL('./proceduralEngine.worker.ts', import.meta.url), { type: 'module' });

    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      worker.terminate();
    };

    const handleMessage = (event: MessageEvent<ProceduralEngineWorkerMessage>) => {
      const message = event.data;

      if (message.requestId !== requestId) {
        return;
      }

      cleanup();

      if (message.type === 'success') {
        resolve(message.project);
        return;
      }

      reject(new Error(message.error));
    };

    const handleError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || 'Falha no worker do procedural engine.'));
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);

    const payload: ProceduralEngineRequestMessage = {
      input: workerInput,
      requestId,
      type: 'generate',
    };

    worker.postMessage(payload, [workerInput.terrain.elevationGrid.buffer]);
  });
}

function cloneWorkerInput(input: ProceduralEngineInput): ProceduralEngineInput {
  return {
    climate: input.climate,
    preferences: {
      infrastructure: [...input.preferences.infrastructure],
    },
    residence: {
      appliances: { ...input.residence.appliances },
      area: input.residence.area,
      calculatedSolarNeed: input.residence.calculatedSolarNeed,
    },
    terrain: {
      ...input.terrain,
      elevationGrid: input.terrain.elevationGrid.slice(),
      polygon: input.terrain.polygon.map((point) => ({ ...point })),
    },
  };
}

function createRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
