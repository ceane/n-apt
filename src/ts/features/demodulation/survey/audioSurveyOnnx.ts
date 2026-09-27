import {
  TIME_DOMAIN_HIDDEN_SIZE,
  TIME_DOMAIN_INPUT_SIZE,
  type TimeDomainDemodModel,
} from "@n-apt/demodulation/survey/audioSurveyMl";

const joinBytes = (chunks: readonly Uint8Array[]) => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

const encodeVarint = (value: number) => {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  while (remaining > 0x7fn) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Uint8Array.from(bytes);
};

const encodeVarintField = (fieldNumber: number, value: number) =>
  joinBytes([encodeVarint((fieldNumber << 3) | 0), encodeVarint(value)]);

const encodeBytesField = (fieldNumber: number, value: Uint8Array) =>
  joinBytes([
    encodeVarint((fieldNumber << 3) | 2),
    encodeVarint(value.length),
    value,
  ]);

const encodeStringField = (fieldNumber: number, value: string) =>
  encodeBytesField(fieldNumber, new TextEncoder().encode(value));

const encodeTensor = (
  name: string,
  dims: readonly number[],
  values: Float32Array,
) => {
  const packedDims = joinBytes(dims.map(encodeVarint));
  const rawData = new Uint8Array(
    values.length * Float32Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(rawData.buffer);
  for (let index = 0; index < values.length; index++) {
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      values[index],
      true,
    );
  }
  return joinBytes([
    encodeBytesField(1, packedDims),
    encodeVarintField(2, 1), // TensorProto.DataType.FLOAT
    encodeStringField(8, name),
    encodeBytesField(9, rawData),
  ]);
};

const encodeNode = (
  name: string,
  opType: string,
  inputs: readonly string[],
  output: string,
) =>
  joinBytes([
    ...inputs.map((input) => encodeStringField(1, input)),
    encodeStringField(2, output),
    encodeStringField(3, name),
    encodeStringField(4, opType),
  ]);

const encodeValueInfo = (name: string, dims: readonly (number | string)[]) => {
  const tensorShape = joinBytes(
    dims.map((dimension) =>
      encodeBytesField(
        1,
        typeof dimension === "number"
          ? encodeVarintField(1, dimension)
          : encodeStringField(2, dimension),
      ),
    ),
  );
  const tensorType = joinBytes([
    encodeVarintField(1, 1), // TypeProto.Tensor.elem_type: FLOAT
    encodeBytesField(2, tensorShape),
  ]);
  const typeProto = encodeBytesField(1, tensorType);
  return joinBytes([
    encodeStringField(1, name),
    encodeBytesField(2, typeProto),
  ]);
};

const encodeOnnxModel = (model: TimeDomainDemodModel) => {
  const transposedInputWeights = new Float32Array(
    TIME_DOMAIN_INPUT_SIZE * TIME_DOMAIN_HIDDEN_SIZE,
  );
  for (let hidden = 0; hidden < TIME_DOMAIN_HIDDEN_SIZE; hidden++) {
    for (let input = 0; input < TIME_DOMAIN_INPUT_SIZE; input++) {
      transposedInputWeights[input * TIME_DOMAIN_HIDDEN_SIZE + hidden] =
        model.inputWeights[hidden * TIME_DOMAIN_INPUT_SIZE + input];
    }
  }
  const outputBias = Float32Array.of(model.outputBias);

  const nodes = [
    encodeNode(
      "input_matmul",
      "MatMul",
      ["iq_windows", "input_weights"],
      "input_linear",
    ),
    encodeNode(
      "input_add",
      "Add",
      ["input_linear", "hidden_bias"],
      "input_biased",
    ),
    encodeNode("input_tanh", "Tanh", ["input_biased"], "hidden"),
    encodeNode(
      "output_matmul",
      "MatMul",
      ["hidden", "output_weights"],
      "output_linear",
    ),
    encodeNode(
      "output_add",
      "Add",
      ["output_linear", "output_bias"],
      "output_biased",
    ),
    encodeNode("output_tanh", "Tanh", ["output_biased"], "pcm"),
  ];
  const initializers = [
    encodeTensor(
      "input_weights",
      [TIME_DOMAIN_INPUT_SIZE, TIME_DOMAIN_HIDDEN_SIZE],
      transposedInputWeights,
    ),
    encodeTensor("hidden_bias", [TIME_DOMAIN_HIDDEN_SIZE], model.hiddenBias),
    encodeTensor(
      "output_weights",
      [TIME_DOMAIN_HIDDEN_SIZE, 1],
      model.outputWeights,
    ),
    encodeTensor("output_bias", [1], outputBias),
  ];
  const graph = joinBytes([
    ...nodes.map((node) => encodeBytesField(1, node)),
    encodeStringField(2, "napt_temporal_iq_to_pcm"),
    ...initializers.map((tensor) => encodeBytesField(5, tensor)),
    encodeBytesField(
      11,
      encodeValueInfo("iq_windows", ["batch", TIME_DOMAIN_INPUT_SIZE]),
    ),
    encodeBytesField(12, encodeValueInfo("pcm", ["batch", 1])),
  ]);
  const defaultOpset = encodeVarintField(2, 13);

  return joinBytes([
    encodeVarintField(1, 9), // ONNX IR version 9
    encodeStringField(2, "n-apt"),
    encodeStringField(3, "audio-survey-temporal-v2"),
    encodeBytesField(7, graph),
    encodeBytesField(8, defaultOpset),
  ]);
};

/** Serialize trained temporal weights as a self-contained ONNX binary model. */
export const serializeTimeDomainModelToOnnx = (
  model: TimeDomainDemodModel,
): Uint8Array => {
  if (
    model.version !== 2 ||
    model.inputSize !== TIME_DOMAIN_INPUT_SIZE ||
    model.hiddenSize !== TIME_DOMAIN_HIDDEN_SIZE ||
    model.inputWeights.length !==
      TIME_DOMAIN_INPUT_SIZE * TIME_DOMAIN_HIDDEN_SIZE ||
    model.hiddenBias.length !== TIME_DOMAIN_HIDDEN_SIZE ||
    model.outputWeights.length !== TIME_DOMAIN_HIDDEN_SIZE ||
    !Number.isFinite(model.outputBias)
  ) {
    throw new Error("Cannot export an unsupported temporal demodulation model");
  }
  return encodeOnnxModel(model);
};
