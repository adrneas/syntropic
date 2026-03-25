/// <reference lib="webworker" />

import { generateProjectCore } from './proceduralEngineCore';
import type {
  ProceduralEngineErrorMessage,
  ProceduralEngineRequestMessage,
  ProceduralEngineSuccessMessage,
} from './workerProtocol';

self.addEventListener('message', (event: MessageEvent<ProceduralEngineRequestMessage>) => {
  const message = event.data;

  if (message.type !== 'generate') {
    return;
  }

  try {
    const project = generateProjectCore(message.input);
    const response: ProceduralEngineSuccessMessage = {
      project,
      requestId: message.requestId,
      type: 'success',
    };

    self.postMessage(response, [
      project.flowDirectionGrid.buffer,
      project.occupationGrid.buffer,
      project.restrictionGrid.buffer,
      project.slopeGrid.buffer,
    ]);
  } catch (error) {
    const response: ProceduralEngineErrorMessage = {
      error: error instanceof Error ? error.message : 'Falha desconhecida no procedural engine.',
      requestId: message.requestId,
      type: 'error',
    };

    self.postMessage(response);
  }
});
