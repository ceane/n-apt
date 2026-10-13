export {
  AUDIO_SURVEY_REFERENCE_SAMPLE_RATE_HZ,
  resampleDecodedAudioToMonoPcm,
} from "@n-apt/encryptedAdapters/ml/audioSurveyFallback";

export interface DecodedAudioBufferLike {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}
