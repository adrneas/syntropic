const TYPED_ARRAY_TAG = '__typedArray';

type SupportedTypedArray = Float32Array | Int8Array | Int32Array | Uint8Array;
type SupportedTypedArrayName = 'Float32Array' | 'Int8Array' | 'Int32Array' | 'Uint8Array';

type SerializedTypedArray = {
  [TYPED_ARRAY_TAG]: SupportedTypedArrayName;
  values: number[];
};

const TYPED_ARRAY_CONSTRUCTORS: Record<
  SupportedTypedArrayName,
  new (values: ArrayLike<number>) => SupportedTypedArray
> = {
  Float32Array,
  Int8Array,
  Int32Array,
  Uint8Array,
};

export function typedArrayReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Float32Array) {
    return serializeTypedArray('Float32Array', value);
  }

  if (value instanceof Int8Array) {
    return serializeTypedArray('Int8Array', value);
  }

  if (value instanceof Int32Array) {
    return serializeTypedArray('Int32Array', value);
  }

  if (value instanceof Uint8Array) {
    return serializeTypedArray('Uint8Array', value);
  }

  return value;
}

export function typedArrayReviver(_key: string, value: unknown): unknown {
  if (!isSerializedTypedArray(value)) {
    return value;
  }

  const Constructor = TYPED_ARRAY_CONSTRUCTORS[value[TYPED_ARRAY_TAG]];

  return new Constructor(value.values);
}

function serializeTypedArray(
  type: SupportedTypedArrayName,
  values: SupportedTypedArray,
): SerializedTypedArray {
  return {
    [TYPED_ARRAY_TAG]: type,
    values: Array.from(values),
  };
}

function isSerializedTypedArray(value: unknown): value is SerializedTypedArray {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (!(TYPED_ARRAY_TAG in value) || !('values' in value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate[TYPED_ARRAY_TAG] === 'string' &&
    Array.isArray(candidate.values)
  );
}
