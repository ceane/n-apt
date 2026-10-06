import {
  VISION_COLOR_CLASS_COUNT,
  VISION_CONV_CHANNELS,
  VISION_CONV_KERNEL,
  VISION_DECODER_ARCHITECTURE,
  VISION_FREQUENCY_BANDS,
  VISION_POOLED_FREQUENCY_BANDS,
  VISION_TEMPORAL_HIDDEN_SIZE,
  validateVisionDecoderModel,
  type VisionDecoderModel,
} from "./visionMl";
import {
  VISION_PREPROCESSING,
  VISION_WIDTH,
  VISION_HEIGHT,
} from "./visionModel";

const INPUT_NAME = "vision_features";
const joinBytes = (chunks: readonly Uint8Array[]) => {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};
const encodeVarint = (value: number | bigint) => {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  while (remaining > 0x7fn) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Uint8Array.from(bytes);
};
const encodeVarintField = (number: number, value: number | bigint) =>
  joinBytes([encodeVarint((number << 3) | 0), encodeVarint(value)]);
const encodeBytesField = (number: number, value: Uint8Array) =>
  joinBytes([
    encodeVarint((number << 3) | 2),
    encodeVarint(value.length),
    value,
  ]);
const encodeStringField = (number: number, value: string) =>
  encodeBytesField(number, new TextEncoder().encode(value));
const encodePackedIntegers = (values: readonly number[]) =>
  joinBytes(values.map(encodeVarint));

const encodeFloatTensor = (
  name: string,
  dims: readonly number[],
  values: Float32Array,
) => {
  const raw = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(raw.buffer);
  for (let index = 0; index < values.length; index++)
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      values[index],
      true,
    );
  return joinBytes([
    encodeBytesField(1, encodePackedIntegers(dims)),
    encodeVarintField(2, 1), // TensorProto.FLOAT
    encodeStringField(8, name),
    encodeBytesField(9, raw),
  ]);
};
const encodeInt64Tensor = (
  name: string,
  dims: readonly number[],
  values: readonly number[],
) => {
  const raw = new Uint8Array(values.length * 8);
  const view = new DataView(raw.buffer);
  values.forEach((value, index) =>
    view.setBigInt64(index * 8, BigInt(value), true),
  );
  return joinBytes([
    encodeBytesField(1, encodePackedIntegers(dims)),
    encodeVarintField(2, 7), // TensorProto.INT64
    encodeStringField(8, name),
    encodeBytesField(9, raw),
  ]);
};
const encodeAttributeInt = (name: string, value: number) =>
  joinBytes([
    encodeStringField(1, name),
    encodeVarintField(3, value),
    encodeVarintField(20, 2), // AttributeProto.INT
  ]);
const encodeAttributeInts = (name: string, values: readonly number[]) =>
  joinBytes([
    encodeStringField(1, name),
    encodeBytesField(8, encodePackedIntegers(values)),
    encodeVarintField(20, 7), // AttributeProto.INTS
  ]);
const encodeNode = (
  name: string,
  opType: string,
  inputs: readonly string[],
  output: string,
  attributes: readonly Uint8Array[] = [],
) =>
  joinBytes([
    ...inputs.map((input) => encodeStringField(1, input)),
    encodeStringField(2, output),
    encodeStringField(3, name),
    encodeStringField(4, opType),
    ...attributes.map((attribute) => encodeBytesField(5, attribute)),
  ]);
const encodeValueInfo = (name: string, dims: readonly (number | string)[]) => {
  const shape = joinBytes(
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
    encodeBytesField(2, shape),
  ]);
  return joinBytes([
    encodeStringField(1, name),
    encodeBytesField(2, encodeBytesField(1, tensorType)),
  ]);
};
const transposeDenseWeights = (
  weights: Float32Array,
  outputCount: number,
  inputCount: number,
) => {
  const result = new Float32Array(inputCount * outputCount);
  for (let output = 0; output < outputCount; output++)
    for (let input = 0; input < inputCount; input++)
      result[input * outputCount + output] =
        weights[output * inputCount + input];
  return result;
};
const encodeVisionModel = (model: VisionDecoderModel) => {
  const nodes = [
    encodeNode("normalize_sub", "Sub", [INPUT_NAME, "input_mean"], "centered"),
    encodeNode(
      "normalize_div",
      "Div",
      ["centered", "input_scale"],
      "normalized",
    ),
    encodeNode(
      "reshape_iq_features",
      "Reshape",
      ["normalized", "reshape_shape"],
      "input_slices",
    ),
    encodeNode(
      "channels_first",
      "Transpose",
      ["input_slices"],
      "input_channels_first",
      [encodeAttributeInts("perm", [0, 3, 1, 2])],
    ),
    encodeNode(
      "pool_fft_bins",
      "AveragePool",
      ["input_channels_first"],
      "frequency_bands",
      [
        encodeAttributeInts("kernel_shape", [
          1,
          VISION_PREPROCESSING.fftSize / VISION_FREQUENCY_BANDS,
        ]),
        encodeAttributeInts("strides", [
          1,
          VISION_PREPROCESSING.fftSize / VISION_FREQUENCY_BANDS,
        ]),
      ],
    ),
    encodeNode(
      "frequency_conv",
      "Conv",
      ["frequency_bands", "conv_weights", "conv_bias"],
      "conv_linear",
      [
        encodeAttributeInts("kernel_shape", [1, VISION_CONV_KERNEL]),
        encodeAttributeInts("pads", [0, 2, 0, 2]),
        encodeAttributeInts("strides", [1, 1]),
      ],
    ),
    encodeNode("frequency_relu", "Relu", ["conv_linear"], "conv_activated"),
    encodeNode(
      "pool_frequency_features",
      "AveragePool",
      ["conv_activated"],
      "pooled_frequency_features",
      [
        encodeAttributeInts("kernel_shape", [
          1,
          VISION_FREQUENCY_BANDS / VISION_POOLED_FREQUENCY_BANDS,
        ]),
        encodeAttributeInts("strides", [
          1,
          VISION_FREQUENCY_BANDS / VISION_POOLED_FREQUENCY_BANDS,
        ]),
      ],
    ),
    encodeNode(
      "flatten_frequency_time",
      "Flatten",
      ["pooled_frequency_features"],
      "temporal_input",
      [encodeAttributeInt("axis", 1)],
    ),
    encodeNode(
      "temporal_gemm",
      "Gemm",
      ["temporal_input", "temporal_weights", "temporal_bias"],
      "temporal_linear",
    ),
    encodeNode("temporal_tanh", "Tanh", ["temporal_linear"], "temporal_hidden"),
    encodeNode(
      "opponent_gemm",
      "Gemm",
      ["temporal_hidden", "opponent_weights", "opponent_bias"],
      "opponent",
    ),
    encodeNode(
      "color_gemm",
      "Gemm",
      ["temporal_hidden", "color_weights", "color_bias"],
      "color_logits",
    ),
  ];
  const temporalInputCount =
    VISION_CONV_CHANNELS *
    VISION_PREPROCESSING.temporalSlices *
    VISION_POOLED_FREQUENCY_BANDS;
  const imageSize = VISION_WIDTH * VISION_HEIGHT * 3;
  const initializers = [
    encodeFloatTensor("input_mean", [model.inputMean.length], model.inputMean),
    encodeFloatTensor(
      "input_scale",
      [model.inputScale.length],
      model.inputScale,
    ),
    encodeInt64Tensor(
      "reshape_shape",
      [4],
      [0, VISION_PREPROCESSING.temporalSlices, VISION_PREPROCESSING.fftSize, 2],
    ),
    encodeFloatTensor(
      "conv_weights",
      [VISION_CONV_CHANNELS, 2, 1, VISION_CONV_KERNEL],
      model.convWeights,
    ),
    encodeFloatTensor("conv_bias", [VISION_CONV_CHANNELS], model.convBias),
    encodeFloatTensor(
      "temporal_weights",
      [temporalInputCount, VISION_TEMPORAL_HIDDEN_SIZE],
      transposeDenseWeights(
        model.temporalWeights,
        VISION_TEMPORAL_HIDDEN_SIZE,
        temporalInputCount,
      ),
    ),
    encodeFloatTensor(
      "temporal_bias",
      [VISION_TEMPORAL_HIDDEN_SIZE],
      model.temporalBias,
    ),
    encodeFloatTensor(
      "opponent_weights",
      [VISION_TEMPORAL_HIDDEN_SIZE, imageSize],
      transposeDenseWeights(
        model.opponentWeights,
        imageSize,
        VISION_TEMPORAL_HIDDEN_SIZE,
      ),
    ),
    encodeFloatTensor("opponent_bias", [imageSize], model.opponentBias),
    encodeFloatTensor(
      "color_weights",
      [VISION_TEMPORAL_HIDDEN_SIZE, VISION_COLOR_CLASS_COUNT],
      transposeDenseWeights(
        model.colorWeights,
        VISION_COLOR_CLASS_COUNT,
        VISION_TEMPORAL_HIDDEN_SIZE,
      ),
    ),
    encodeFloatTensor(
      "color_bias",
      [VISION_COLOR_CLASS_COUNT],
      model.colorBias,
    ),
  ];
  const graph = joinBytes([
    ...nodes.map((node) => encodeBytesField(1, node)),
    encodeStringField(2, "napt_vision_frequency_temporal_decoder"),
    ...initializers.map((tensor) => encodeBytesField(5, tensor)),
    encodeBytesField(
      11,
      encodeValueInfo(INPUT_NAME, [
        "batch",
        VISION_PREPROCESSING.tensorShape.reduce(
          (product, dimension) => product * dimension,
          1,
        ),
      ]),
    ),
    encodeBytesField(12, encodeValueInfo("opponent", ["batch", imageSize])),
    encodeBytesField(
      12,
      encodeValueInfo("color_logits", ["batch", VISION_COLOR_CLASS_COUNT]),
    ),
  ]);
  return joinBytes([
    encodeVarintField(1, 9), // ONNX IR version 9
    encodeStringField(2, "n-apt"),
    encodeStringField(3, VISION_DECODER_ARCHITECTURE),
    encodeBytesField(7, graph),
    encodeBytesField(8, encodeVarintField(2, 13)), // opset 13
  ]);
};

/** Serialize the local neural decoder to a self-contained ONNX model. */
export function serializeVisionDecoderToOnnx(
  model: VisionDecoderModel,
): Uint8Array {
  validateVisionDecoderModel(model);
  return encodeVisionModel(model);
}
