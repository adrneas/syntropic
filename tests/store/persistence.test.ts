import { describe, expect, it } from 'vitest';
import { typedArrayReplacer, typedArrayReviver } from '../../src/store/persistence';

describe('typedArray persistence helpers', () => {
  it('serializes and restores supported typed arrays', () => {
    const original = {
      flowDirectionGrid: new Int8Array([-1, 2, 3]),
      occupationGrid: new Int32Array([0, -1, 4]),
      restrictionGrid: new Uint8Array([0, 1, 1]),
      slopeGrid: new Float32Array([0, 1.5, 3.25]),
    };

    const serialized = JSON.stringify(original, typedArrayReplacer);
    const restored = JSON.parse(serialized, typedArrayReviver) as typeof original;

    expect(restored.flowDirectionGrid).toBeInstanceOf(Int8Array);
    expect(restored.occupationGrid).toBeInstanceOf(Int32Array);
    expect(restored.restrictionGrid).toBeInstanceOf(Uint8Array);
    expect(restored.slopeGrid).toBeInstanceOf(Float32Array);

    expect(Array.from(restored.flowDirectionGrid)).toEqual(Array.from(original.flowDirectionGrid));
    expect(Array.from(restored.occupationGrid)).toEqual(Array.from(original.occupationGrid));
    expect(Array.from(restored.restrictionGrid)).toEqual(Array.from(original.restrictionGrid));
    expect(Array.from(restored.slopeGrid)).toEqual(Array.from(original.slopeGrid));
  });
});
