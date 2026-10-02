#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decryptArchivedIqPayload } from './crypto.mjs';
import { createRunner } from './runner.mjs';
import { decodeIq, spectrumFromIq, validateDataset, selectFrameIndices, readTrainingCapture } from './io.mjs';
import { FEATURE_NAMES, PREPROCESSING, validateModel, inferModel } from '../../src/ts/features/classification/native/core.ts';
import { summarizeClassificationRows } from './classification-report.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const numericList = (v, label) => { const a = v.split(',').map(Number); if (a.some(x => !Number.isInteger(x) || x < 2 || x > 1048576 || (x & (x - 1)))) throw new Error(`${label} must be comma-separated powers of two`); return a; };
function args(argv) {
  const [command, ...rest] = argv, out = {};
  for (let i=0;i<rest.length;i++) { const k=rest[i]; if (!k.startsWith('--')) throw new Error(`Unexpected argument ${k}`); const key=k.slice(2).replaceAll('-','_'); const v=rest[++i]; if (!v || v.startsWith('--')) throw new Error(`Missing value for ${k}`); out[key]=v; }
  return { command, ...out };
}
function readJsonLines(text) { return text.split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeRows(rows) { return `${rows.map(r=>JSON.stringify(r)).join('\n')}\n`; }
async function captureRaw(record, manifestDir, envFile) {
  if (record.format !== 'napt') return { bytes: await readFile(path.resolve(manifestDir, record.input)), format: record.format, manifest: record };
  const temp = await mkdtemp(path.join(tmpdir(),'napt-classifier-'));
  try {
    const output = path.join(temp,'decrypted');
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(root,'scripts/test/manual_napt_capture_harness.mjs'),'--input',path.resolve(manifestDir,record.input),'--out-dir',output,'--fft-size',String(record.fftSize ?? 65536),...(envFile?['--env-file',path.resolve(envFile)]:[])],{cwd:root,stdio:['ignore','ignore','pipe']});
      let errors=''; child.stderr.on('data',chunk=>{errors+=chunk;}); child.on('error',reject); child.on('exit',code=>code===0?resolve():reject(new Error(errors||`.napt preparation failed (${code})`)));
    });
    const m=JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8'));
    const captureRate=[m.capture_metadata?.sample_rate_hz,m.capture_metadata?.capture_sample_rate_hz,m.capture_metadata?.hardware_sample_rate_hz].map(Number).find(value=>Number.isFinite(value)&&value>0);
    if(captureRate && Math.abs(captureRate-record.sampleRateHz)>1) throw new Error(`Declared sample rate disagrees with ${record.id} capture metadata`);
    return { bytes: await readFile(path.join(output,'raw.iq.u8')), format:'u8', manifest: record };
  } finally { await rm(temp,{recursive:true,force:true}); }
}
async function captureRawFromPackage(capture, record, envFile) {
  if (!capture.archiveSource) {
    return captureRaw({
      ...record,
      input: path.relative(capture.packageRoot, capture.capturePath),
    }, capture.packageRoot, envFile);
  }
  const temp = await mkdtemp(path.join(tmpdir(), 'napt-classifier-package-'));
  try {
    await writeFile(path.join(temp, capture.captureName), capture.captureBytes, { flag: 'wx' });
    return await captureRaw({ ...record, input: capture.captureName }, temp, envFile);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
async function writePreparedIq(iq, directory) {
  await mkdir(directory, { recursive: true });
  const raw=Buffer.alloc(iq.length*4); for(let i=0;i<iq.length;i++) raw.writeFloatLE(iq[i],4*i);
  const input=path.join(directory,'raw.iq.f32le'); await writeFile(input,raw); return input;
}
const PACKAGE_SPLITS = new Set(['train', 'validation', 'test', 'acceptance', 'unlabeled', 'challenge-mock', 'challenge-sinc']);

function packageWindow(value) {
  const key = String(value ?? '').trim().toLowerCase().replaceAll('_', '-');
  if (key === 'hann' || key === 'hanning') return 'hann';
  if (['hamming', 'blackman', 'nuttall', 'rectangular'].includes(key)) return key;
  return null;
}

function packageConfig(metadata, patch, channel, sampleRateHint, centerHint, captureName) {
  const value = (...items) => items.find(item => item !== undefined && item !== null && item !== '');
  const sampleRateHz = Number(value(
    patch.capture_sample_rate_hz,
    patch.sample_rate_hz,
    patch.hardware_sample_rate_hz,
    metadata.capture_sample_rate_hz,
    metadata.sample_rate_hz,
    metadata.hardware_sample_rate_hz,
    metadata.sample_rate,
    channel?.sample_rate_hz,
    sampleRateHint,
  ));
  const centerFrequencyHz = Number(value(
    patch.center_frequency_hz,
    patch.center_freq_hz,
    metadata.center_frequency_hz,
    metadata.center_frequency,
    channel?.center_freq_hz,
    centerHint,
  ));
  const fftValue = value(
    patch.fft_size,
    patch.configured_fft_size,
    metadata.fft_size,
    metadata.configured_fft_size,
    channel?.bins_per_frame,
  );
  const fftSize = Number(fftValue);
  const configuredFftSize = Number(value(patch.configured_fft_size, patch.fft_size, metadata.configured_fft_size, fftValue));
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error(`${captureName}: capture metadata has no valid sample rate`);
  }
  if (!Number.isFinite(centerFrequencyHz)) {
    throw new Error(`${captureName}: capture metadata has no valid center frequency`);
  }
  if (!Number.isInteger(fftSize) || fftSize < 2 || (fftSize & (fftSize - 1)) !== 0) {
    throw new Error(`${captureName}: capture metadata has no supported FFT size`);
  }
  if (!Number.isInteger(configuredFftSize) || configuredFftSize < 2 || (configuredFftSize & (configuredFftSize - 1)) !== 0) {
    throw new Error(`${captureName}: capture metadata has no valid configured FFT size`);
  }
  return {
    sampleRateHz,
    centerFrequencyHz,
    fftSize,
    configuredFftSize,
    window: packageWindow(value(patch.fft_window, patch.window, metadata.fft_window, metadata.window, channel?.fft_window)),
  };
}

function v6CaptureEvents(frameUpdates) {
  let initialSeen = false;
  const optionsAppliedEvents = [];
  const streamInterruptedEvents = [];
  for (const update of frameUpdates) {
    const kind = update.kind ?? 'PatchOptionsApplied';
    if (kind === 'StreamInterrupted') {
      const patch = update.patch ?? {};
      if (patch.code !== 1) {
        throw new Error('V6 StreamInterrupted frame update must use code 1');
      }
      if ((update.frame_sequence !== undefined && !Number.isInteger(update.frame_sequence)) ||
        (update.next_frame_sequence !== undefined && !Number.isInteger(update.next_frame_sequence))) {
        throw new Error('V6 StreamInterrupted frame update has an invalid frame sequence');
      }
      streamInterruptedEvents.push({
        kind,
        code: 1,
        byteOffset: update.sample_offset,
        timestampMs: update.timestamp_us / 1000,
        frameSequence: update.frame_sequence ?? null,
        ...(update.next_frame_sequence === undefined ? {} : { nextFrameSequence: update.next_frame_sequence }),
        ...(typeof patch.reason === 'string' ? { reason: patch.reason } : {}),
      });
      continue;
    }
    if (kind === 'Frame') {
      if (!Number.isInteger(update.frame_sequence) || update.frame_sequence < 0) {
        throw new Error('V6 Frame update has an invalid frame sequence');
      }
      continue;
    }
    if (kind !== 'PatchOptionsApplied') {
      throw new Error(`Unsupported V6 frame update kind: ${kind}`);
    }
    if (update.sample_offset === 0 && !initialSeen) {
      initialSeen = true;
      continue;
    }
    const patch = update.patch && typeof update.patch === 'object' ? update.patch : {};
    optionsAppliedEvents.push({
      kind: 'PatchOptionsApplied',
      byteOffset: update.sample_offset,
      timestampMs: update.timestamp_us / 1000,
      changedFields: Object.keys(patch),
      patch: { ...patch },
      ...(update.source_id ? { sourceId: update.source_id } : {}),
      ...(update.job_id ? { jobId: update.job_id } : {}),
    });
  }
  return { optionsAppliedEvents, streamInterruptedEvents };
}

function contiguousChunkRuns(chunks, expectedChannel = 0) {
  const runs = [];
  let previousEnd = 0;
  let previous = null;
  for (const chunk of chunks) {
    if (chunk.channel !== expectedChannel) {
      throw new Error(`Only channel ${expectedChannel} IQ data is supported by classifier prepare`);
    }
    if (!Number.isSafeInteger(chunk.sampleOffset) || chunk.sampleOffset < 0 ||
      chunk.data.byteLength % 2 !== 0 || chunk.data.byteLength === 0) {
      throw new Error('V6 IQ capture contains an invalid chunk range');
    }
    const startByte = chunk.sampleOffset * 2;
    const endByte = startByte + chunk.data.byteLength;
    if (!Number.isSafeInteger(startByte) || !Number.isSafeInteger(endByte) || startByte < previousEnd) {
      throw new Error('V6 IQ chunks overlap or are out of order');
    }
    const part = { startByte, endByte, data: chunk.data };
    if (previous && startByte === previous.endByte) {
      previous.parts.push(part);
      previous.endByte = endByte;
    } else {
      previous = { startByte, endByte, parts: [part] };
      runs.push(previous);
    }
    previousEnd = endByte;
  }
  return runs;
}

function bytesForInterval(run, startByte, endByte) {
  const parts = [];
  for (const chunk of run.parts) {
    const from = Math.max(startByte, chunk.startByte);
    const to = Math.min(endByte, chunk.endByte);
    if (to > from) parts.push(Buffer.from(chunk.data.subarray(from - chunk.startByte, to - chunk.startByte)));
  }
  if (!parts.length) return Buffer.alloc(0);
  return parts.length === 1 ? parts[0] : Buffer.concat(parts, endByte - startByte);
}

async function preparePackage(a) {
  if (!a.split || !PACKAGE_SPLITS.has(a.split)) {
    throw new Error('prepare --package requires --split train|validation|test|acceptance|unlabeled|challenge-mock|challenge-sinc');
  }
  const { readCapturePackage, decodeV6IqContainer } = await import('./package.mjs');
  const capture = await readCapturePackage(a.package);
  const labels = capture.labels;
  const session = String(a.session ?? labels.sessionId ?? '').trim();
  if (!session) throw new Error('Data Package has no sessionId; provide --session');
  if (capture.format === 'wav') {
    throw new Error('WAV packages are preserved for annotation/archive workflows; prepare requires raw I/Q or browser frame JSON');
  }

  const out = path.resolve(a.out ?? '/private/tmp/napt-classifier/prepared');
  if (out === capture.packageRoot || out.startsWith(`${capture.packageRoot}${path.sep}`)) {
    throw new Error('Prepared output must be outside the source Data Package directory');
  }
  await mkdir(out, { recursive: true });
  const records = [];
  const rowBase = {
    session,
    split: a.split,
    label: labels.annotations.label,
    channel: labels.annotations.channel,
    captureId: capture.captureId,
    sourceCaptureId: capture.captureId,
    captureIdentity: capture.captureIdentity,
    captureAnnotations: labels.annotations,
    annotationEvents: labels.annotationEvents,
    interferenceMarkedEvents: labels.interferenceMarkedEvents,
  };

  if (capture.format === 'json') {
    const rawCapture = JSON.parse(capture.captureBytes.toString('utf8'));
    const browser = readTrainingCapture(rawCapture, null, capture.captureName);
    for (const frame of browser.frames) {
      const id = `pkg_${createHash('sha256').update(`${capture.captureId}:${frame.sequence}`).digest('hex').slice(0, 16)}`;
      const iq = decodeIq(frame.iqBytes, 'u8');
      const input = await writePreparedIq(iq, path.join(out, id));
      records.push({
        ...rowBase,
        id,
        input: path.relative(out, input),
        format: 'f32le',
        browserSessionId: browser.sessionId,
        sourceId: browser.config.sourceId,
        streamEpoch: frame.streamEpoch,
        optionsRevision: frame.optionsRevision,
        frameSequence: frame.sequence,
        timestampStartMs: frame.timestampMs,
        sampleRateHz: browser.config.sampleRateHz,
        centerFrequencyHz: browser.config.centerFrequencyHz,
        configuredFftSize: browser.config.configuredFftSize,
        analysisFftSize: browser.config.fftSize,
        window: browser.config.window,
        captureWindow: browser.config.window,
        temporalResolution: browser.config.temporalResolution,
        validSamples: frame.validSamples,
        iqByteCount: frame.iqBytes.length,
        complexSamples: iq.length / 2,
        tuneEvents: browser.tuneEvents,
        optionsAppliedEvents: browser.optionsAppliedEvents,
        streamInterruptedEvents: browser.streamInterruptedEvents,
        stopReason: browser.stopReason,
      });
    }
  } else {
    const metadata = capture.metadata ?? {};
    const channel = (metadata.channels ?? [])[0] ?? null;
    if (capture.format === 'napt' && (metadata.channels?.length ?? 0) > 1) {
      throw new Error('Classifier prepare currently accepts single-channel V6 .napt captures; preserve multi-channel captures unchanged until channel-wise decoding is implemented');
    }
    const updatesRaw = capture.format === 'iq' ? capture.iqContainer.frameUpdates : (metadata.frame_updates ?? []);
    if (!Array.isArray(updatesRaw) || updatesRaw.some(update => !update || typeof update !== 'object' || Array.isArray(update))) {
      throw new Error('V6 capture frame_updates must be an array of objects');
    }
    const frameUpdates = updatesRaw.filter(update => update.channel === undefined || update.channel === 0);
    if (metadata.lossless === true && metadata.temporal_resolution === 'lossless' &&
      Number.isSafeInteger(metadata.frame_count) && metadata.frame_count > 0) {
      const timestampedFrameCount = frameUpdates.filter(update => update.kind === 'Frame').length;
      if (timestampedFrameCount !== metadata.frame_count) {
        throw new Error(`${capture.captureName}: lossless capture declares ${metadata.frame_count} frames but has ${timestampedFrameCount} timestamped Frame updates`);
      }
    }
    const initialConfig = packageConfig(metadata, {}, channel, null, null, capture.captureName);
    let chunks;
    if (capture.format === 'iq') {
      if (capture.iqContainer?.encrypted) {
        const envFile = a.env_file ?? '.env.local';
        const payload = await decryptArchivedIqPayload({
          captureBytes: capture.captureBytes,
          archive: capture.archive,
          envFile,
        });
        chunks = decodeV6IqContainer(capture.captureBytes, metadata, payload).chunks;
      } else {
        chunks = capture.iqContainer.chunks;
      }
    } else if (capture.format === 'napt') {
      const decrypted = await captureRawFromPackage(capture, {
        format: 'napt',
        fftSize: initialConfig.fftSize,
        sampleRateHz: initialConfig.sampleRateHz,
        id: capture.captureId,
      }, a.env_file);
      chunks = [{ sampleOffset: 0, channel: 0, data: decrypted.bytes }];
    } else {
      throw new Error(`Classifier prepare does not support .${capture.format} captures`);
    }

    const runs = contiguousChunkRuns(chunks);
    const totalBytes = chunks.reduce((max, chunk) => Math.max(max, chunk.sampleOffset * 2 + chunk.data.byteLength), 0);
    const updates = frameUpdates.map((update, index) => {
      if (!Number.isSafeInteger(update.sample_offset) || update.sample_offset < 0 || update.sample_offset % 2 !== 0 ||
        update.sample_offset > totalBytes || !update.patch || typeof update.patch !== 'object' || Array.isArray(update.patch) ||
        !Number.isFinite(update.timestamp_us)) {
        throw new Error(`V6 frame update ${index} has invalid byte offset, timestamp, or patch`);
      }
      return { ...update, patch: { ...update.patch } };
    });
    for (let index = 1; index < updates.length; index++) {
      if (updates[index].sample_offset < updates[index - 1].sample_offset) {
        throw new Error('V6 frame updates are out of order');
      }
    }

    const timingUpdates = updates.filter(update => update.kind === 'Frame' || update.kind === undefined || update.kind === 'PatchOptionsApplied');
    const firstTimedUpdate = timingUpdates.find(update => Number.isFinite(update.timestamp_us));
    const firstUpdate = timingUpdates.find(update => update.sample_offset === 0);
    const initialTimestamp = Number.isFinite(firstUpdate?.timestamp_us)
      ? firstUpdate.timestamp_us / 1000
      : firstTimedUpdate
        ? firstTimedUpdate.timestamp_us / 1000 - (firstTimedUpdate.sample_offset / 2 / initialConfig.sampleRateHz) * 1000
        : (capture.captureTimestampMs ?? capture.captureIdentity.capturedAtTimestampMs);
    if (!Number.isFinite(initialTimestamp)) {
      throw new Error(`${capture.captureName}: V6 capture has no usable starting timestamp`);
    }

    const { optionsAppliedEvents: appliedEvents, streamInterruptedEvents } = v6CaptureEvents(updates);
    const discontinuities = [];
    if (runs.length && runs[0].startByte > 0) {
      discontinuities.push({ kind: 'MissingIqRange', fromByteOffset: 0, toByteOffset: runs[0].startByte });
    }
    for (let index = 1; index < runs.length; index++) {
      discontinuities.push({
        kind: 'MissingIqRange',
        fromByteOffset: runs[index - 1].endByte,
        toByteOffset: runs[index].startByte,
      });
    }

    let segmentIndex = 0;
    let previousPreparedEndByte = 0;
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const run = runs[runIndex];
      const cuts = [
        run.startByte,
        ...updates.map(update => update.sample_offset).filter(offset => offset > run.startByte && offset < run.endByte),
        run.endByte,
      ].sort((left, right) => left - right);
      const uniqueCuts = cuts.filter((value, index) => index === 0 || value !== cuts[index - 1]);
      for (let cut = 0; cut < uniqueCuts.length - 1; cut++) {
        const startByte = uniqueCuts[cut];
        const endByte = uniqueCuts[cut + 1];
        if (endByte <= startByte) continue;

        const activeUpdates = updates.filter(update => update.sample_offset <= startByte);
        const activePatch = activeUpdates
          .filter(update => (update.kind ?? 'PatchOptionsApplied') === 'PatchOptionsApplied')
          .reduce((state, update) => ({ ...state, ...update.patch }), {});
        const configurationSegmentIndex = Math.max(0, activeUpdates.filter(update =>
          (update.kind ?? 'PatchOptionsApplied') === 'PatchOptionsApplied').length - 1);
        const continuitySegmentIndex = activeUpdates.filter(update => update.kind === 'StreamInterrupted').length;
        const config = packageConfig(metadata, activePatch, channel, initialConfig.sampleRateHz, initialConfig.centerFrequencyHz, capture.captureName);
        const bytes = bytesForInterval(run, startByte, endByte);
        if (bytes.byteLength !== endByte - startByte || bytes.byteLength % 2 !== 0) {
          throw new Error('V6 IQ segment has a discontinuity or incomplete I/Q pair');
        }

        const id = `pkg_${createHash('sha256').update(`${capture.captureId}:${segmentIndex}`).digest('hex').slice(0, 16)}`;
        const iq = decodeIq(bytes, 'u8');
        const input = await writePreparedIq(iq, path.join(out, id));
        const startUpdate = [...timingUpdates].reverse().find(update => update.sample_offset <= startByte);
        const frameUpdate = [...timingUpdates].reverse().find(update => update.kind === 'Frame' && update.sample_offset === startByte);
        const sourceId = frameUpdate?.source_id ?? metadata.source_id ?? `capture:${capture.captureId}`;
        const timestampStartMs = Number.isFinite(startUpdate?.timestamp_us)
          ? startUpdate.timestamp_us / 1000 + ((startByte - startUpdate.sample_offset) / 2 / config.sampleRateHz) * 1000
          : initialTimestamp + (startByte / 2 / config.sampleRateHz) * 1000;
        const previousRunEnd = runIndex === 0 ? 0 : runs[runIndex - 1].endByte;
        const sourceChunkGapBefore = startByte === run.startByte && startByte > previousRunEnd;
        records.push({
          ...rowBase,
          id,
          input: path.relative(out, input),
          format: 'f32le',
          sourceId,
          streamEpoch: activePatch.stream_epoch ?? activePatch.to_stream_epoch ?? activePatch.toStreamEpoch ?? metadata.stream_epoch ?? null,
          optionsRevision: activePatch.options_revision ?? activePatch.to_options_revision ?? activePatch.toOptionsRevision ?? activePatch.optionsRevision ?? metadata.options_revision ?? null,
          timestampStartMs,
          sampleRateHz: config.sampleRateHz,
          centerFrequencyHz: config.centerFrequencyHz,
          configuredFftSize: config.configuredFftSize,
          analysisFftSize: config.fftSize,
          window: config.window,
          captureWindow: config.window,
          temporalResolution: frameUpdate ? 'frame-indexed' : 'contiguous-span',
          ...(frameUpdate ? { frameSequence: frameUpdate.frame_sequence, frameTimestampUs: frameUpdate.timestamp_us } : {}),
          configurationSegmentIndex,
          continuitySegmentIndex,
          sourceSampleOffsetBytes: startByte,
          sourceChunkGapBefore,
          ...(frameUpdate ? {} : { captureFrameUpdates: updates }),
          captureDiscontinuities: discontinuities,
          optionsAppliedEvents: appliedEvents.filter(event => event.byteOffset >= previousPreparedEndByte && event.byteOffset <= startByte),
          streamInterruptedEvents: streamInterruptedEvents.filter(event => event.byteOffset >= previousPreparedEndByte && event.byteOffset <= startByte),
          validSamples: bytes.byteLength / 2,
          iqByteCount: bytes.byteLength,
          complexSamples: iq.length / 2,
          segmentIndex,
        });
        segmentIndex++;
        previousPreparedEndByte = endByte;
      }
    }
  }

  if (!records.length) throw new Error(`${capture.captureName}: no usable I/Q samples were prepared`);
  const dataset = validateDataset({ version: 1, recordings: records });
  await writeFile(path.join(out, 'dataset.json'), `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(JSON.stringify({
    prepared: out,
    sourceCaptureId: capture.captureId,
    recordings: records.length,
    split: a.split,
    encryptedOrRawIQNotIncludedInGit: true,
  }, null, 2));
}
async function prepare(a) {
  if(a.package) return preparePackage(a);
  if(!a.manifest) throw new Error('prepare requires --manifest JSON; labels/splits are explicit');
  const manifestPath=path.resolve(a.manifest), base=path.dirname(manifestPath), dataset=validateDataset(JSON.parse(await readFile(manifestPath,'utf8')));
  const out=path.resolve(a.out ?? '/private/tmp/napt-classifier/prepared'); await mkdir(out,{recursive:true});
  const records=[];
  for(const r of dataset.recordings) {
    if(r.format==='browser-capture') {
      const rawCapture=JSON.parse(await readFile(path.resolve(base,r.input),'utf8'));
      const sidecar=r.annotations ? JSON.parse(await readFile(path.resolve(base,r.annotations),'utf8')) : null;
      const capture=readTrainingCapture(rawCapture,sidecar,path.basename(r.input));
      const config=capture.config;
      if(Math.abs(config.sampleRateHz-r.sampleRateHz)>1 || Math.abs(config.centerFrequencyHz-r.centerFrequencyHz)>1) throw new Error(`${r.id}: declared sample rate or center frequency disagrees with browser capture metadata`);
      for(const frame of capture.frames) {
        const id=`${r.id}_seq${frame.sequence}`;
        const iq=decodeIq(frame.iqBytes,'u8');
        const input=await writePreparedIq(iq,path.join(out,id));
        records.push({...r,id,input:path.relative(out,input),format:'f32le',captureId:r.id,sourceCaptureId:capture.captureId,captureIdentity:capture.captureIdentity,browserSessionId:capture.sessionId,captureAnnotations:capture.annotations,annotationEvents:capture.annotationEvents,interferenceMarkedEvents:capture.interferenceMarkedEvents,tuneEvents:capture.tuneEvents,optionsAppliedEvents:capture.optionsAppliedEvents,streamInterruptedEvents:capture.streamInterruptedEvents,stopReason:capture.stopReason,sourceId:config.sourceId,streamEpoch:frame.streamEpoch,optionsRevision:frame.optionsRevision,frameSequence:frame.sequence,timestampStartMs:frame.timestampMs,configuredFftSize:config.configuredFftSize,analysisFftSize:config.fftSize,window:config.window,captureWindow:config.window,temporalResolution:config.temporalResolution,validSamples:frame.validSamples,iqByteCount:frame.iqBytes.length,complexSamples:iq.length/2});
      }
      continue;
    }
    if(r.format==='napt' && !r.fftSize) throw new Error(`${r.id}: .napt requires explicit fftSize`);
    const {bytes,format}=await captureRaw(r,base,a.env_file); const iq=decodeIq(bytes,format);
    const input=await writePreparedIq(iq,path.join(out,r.id));
    const row={...r,input:path.relative(out,input),format:'f32le',complexSamples:iq.length/2,split:r.split,label:r.label}; records.push(row);
  }
  await writeFile(path.join(out,'dataset.json'),JSON.stringify({version:1,recordings:records},null,2)+'\n');
  console.log(JSON.stringify({prepared:out,recordings:records.length,encryptedOrRawIQNotIncludedInGit:true},null,2));
}
function parseCrops(text) {
  return (text??'0:1').split(',').map(s=>{const [a,b]=s.split(':').map(Number);if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>1||a>=b)throw new Error('Crops must be fractions in 0..1, like 0:1,0.25:0.75');return [a,b];});
}
function frameIndicesLimit(value) { return Number(value ?? 64); }
async function extract(a) {
  if(!a.dataset) throw new Error('extract requires --dataset prepared/dataset.json');
  const datasetPath=path.resolve(a.dataset),base=path.dirname(datasetPath),dataset=validateDataset(JSON.parse(await readFile(datasetPath,'utf8')));
  const sizes=numericList(a.fft_sizes??'1024,4096,16384','--fft-sizes'), crops=parseCrops(a.crops), window=a.window??'hann';
  if(!['rectangular','hann','hamming','blackman','blackman-harris','nuttall'].includes(window)) throw new Error('Unsupported window');
  const runner=await createRunner(), rows=[], insufficientHistory=new Map();
  try {
    for(const r of dataset.recordings) {
      const iq=decodeIq(await readFile(path.resolve(base,r.input)),'f32le'), n=iq.length/2;
      for(const fftSize of sizes) {
        for(const [startFraction,endFraction] of crops) {
          const hop=Math.max(1,Math.floor(fftSize/2)), totalFrames=n<=fftSize?1:Math.floor((n-fftSize)/hop)+1, frameIndices=selectFrameIndices(totalFrames, Number(a.max_frames??64));
          const temporal=[];
          const streamKey=JSON.stringify([r.captureId??r.id,r.sourceId??null,r.streamEpoch??null,r.optionsRevision??null,
            r.configurationSegmentIndex??null,r.continuitySegmentIndex??null,
            r.sampleRateHz,r.centerFrequencyHz,r.analysisFftSize??r.configuredFftSize??null,r.captureWindow??r.window??null,
            r.temporalResolution === 'frame-indexed' ? null : r.segmentIndex??null,fftSize,startFraction,endFraction,window]);
          for(let f=0;f<frameIndices.length;f++) {
            const sourceFrameIndex=frameIndices[f], start=sourceFrameIndex*hop, valid=Math.min(fftSize,n-start); if(valid<2) break;
            const chunk=iq.subarray(start*2,(start+valid)*2), fft=spectrumFromIq(chunk,fftSize,window);
            const startBin=Math.floor(startFraction*fft.fftSize), endBin=Math.max(startBin+1,Math.floor(endFraction*fft.fftSize));
            const spectrum=fft.spectrum.subarray(startBin,endBin);
            const timestampMs=Number(r.timestampStartMs??0)+start/r.sampleRateHz*1000;
            const metadata={sourceId:streamKey,frameId:`${r.id}:${fftSize}:${startFraction}:${start}`,timestampMs,acquisitionSampleRateHz:r.sampleRateHz,analysisSampleRateHz:r.sampleRateHz,fftSize:fft.fftSize,validSamples:fft.validSamples,window,centerFrequencyHz:r.centerFrequencyHz,retainedStartBin:startBin,retainedEndBin:endBin};
            const extracted=await runner.extract(Array.from(spectrum),metadata);
            // Keep every selected capture frame in the timestamped output, even
            // when native resolution/support is too weak to return classifier
            // evidence. Missing features stay unavailable rather than becoming
            // confident negatives or disappearing from the temporal record.
            let result=extracted;
            if(!result){
              const previous=insufficientHistory.get(streamKey);
              const frameCount=previous&&timestampMs>previous.timestampMs&&timestampMs-previous.timestampMs<=1000
                ?previous.frameCount+1:1;
              insufficientHistory.set(streamKey,{timestampMs,frameCount});
              result={
              values:FEATURE_NAMES.map((_,i)=>i===13?spectrum.length/metadata.fftSize:i===14?metadata.validSamples/metadata.fftSize:0),
              status:'insufficient_evidence',available:{narrow:false,bridge:false,envelope:false},
              ruleScore:null,frameCount,evidenceMs:0,latencyMs:null,
              };
            }else insufficientHistory.delete(streamKey);
            temporal.push({
              id:r.id,captureId:r.captureId??r.id,sourceCaptureId:r.sourceCaptureId??null,captureIdentity:r.captureIdentity??null,
              recordingId:r.id,session:r.session,split:r.split,label:r.label,captureAnnotations:r.captureAnnotations??null,
              annotationEvents:r.annotationEvents??[],interferenceMarkedEvents:r.interferenceMarkedEvents??[],
              tuneEvents:r.tuneEvents??[],optionsAppliedEvents:r.optionsAppliedEvents??[],streamInterruptedEvents:r.streamInterruptedEvents??[],
              stopReason:r.stopReason??null,preprocessing:PREPROCESSING,featureNames:FEATURE_NAMES,features:result.values,
              status:result.status,available:result.available,ruleScore:result.ruleScore,qualityScore:result.values?.[9]??null,
              fftSize:metadata.fftSize,validSamples:metadata.validSamples,sampleRateHz:r.sampleRateHz,
              analysisSampleRateHz:r.sampleRateHz,binHz:r.sampleRateHz/metadata.fftSize,
              resolutionHz:result.resolution?.resolutionHz??null,
              firstBinHz:r.centerFrequencyHz-r.sampleRateHz/2+startBin*r.sampleRateHz/metadata.fftSize,
              retainedStartBin:startBin,retainedEndBin:endBin,visibleFraction:spectrum.length/metadata.fftSize,
              acquisitionFftSize:r.analysisFftSize??r.configuredFftSize??null,configuredFftSize:r.configuredFftSize??null,
              acquisitionWindow:r.captureWindow??r.window??null,analysisWindow:window,window,
              frameIndex:sourceFrameIndex,timestampMs,evidenceMs:result.evidenceMs,temporalFrameCount:result.frameCount??1,
              latencyMs:result.latencyMs??null,sourceId:r.sourceId??null,streamEpoch:r.streamEpoch??null,
              optionsRevision:r.optionsRevision??null,frameSequence:r.frameSequence??null,frameTimestampUs:r.frameTimestampUs??null,
              sourceSampleOffsetBytes:r.sourceSampleOffsetBytes??null,analysisFftSize:r.analysisFftSize??null,
            });
          }
          rows.push(...temporal);
        }
      }
    }
  } finally { await runner.close(); }
  await writeFile(path.resolve(a.out??path.join(base,'features.jsonl')),writeRows(rows));
  console.log(JSON.stringify({features:rows.length,recordings:dataset.recordings.length,fftSizes:sizes,crops,window,maxFramesPerResolution:frameIndicesLimit(a.max_frames)},null,2));
}
async function classify(a) {
  if(!a.input||!a.model) throw new Error('classify requires --input prepared/dataset.json --model artifact.json');
  const datasetPath=path.resolve(a.input),base=path.dirname(datasetPath),dataset=validateDataset(JSON.parse(await readFile(datasetPath,'utf8'))), model=validateModel(JSON.parse(await readFile(path.resolve(a.model),'utf8')));
  const temp=path.join(base,`.classify-${process.pid}.jsonl`);
  // Reuse the single shared extraction implementation. Label is stripped from output after extraction.
  const filtered={...dataset,recordings:dataset.recordings.map((r,i)=>({...r,id:`${i}_${r.id}`,session:`${i}_${r.session}`,split:'unlabeled',label:'uncertain'}))};
  const copy=path.join(base,`.classify-${process.pid}.json`); await writeFile(copy,JSON.stringify(filtered));
  try { await extract({dataset:copy,fft_sizes:a.fft_sizes??'4096',crops:a.crops??'0:1',window:a.window??'hann',out:temp});
    const rows=readJsonLines(await readFile(temp,'utf8')).map(r=>{const score=r.status==='ready'?inferModel(model,r.features):null;return {
      id:r.id,captureId:r.captureId,sourceCaptureId:r.sourceCaptureId,captureIdentity:r.captureIdentity,session:r.session,
      frameIndex:r.frameIndex,frameSequence:r.frameSequence,timestampMs:r.timestampMs,score,
      decision:score===null?null:score>=model.threshold,status:r.status,available:r.available,
      sampleRateHz:r.sampleRateHz,analysisSampleRateHz:r.analysisSampleRateHz,rateValidated:model.validatedSampleRatesHz.includes(r.sampleRateHz),
      fftSize:r.fftSize,validSamples:r.validSamples,binHz:r.binHz,resolutionHz:r.resolutionHz,
      firstBinHz:r.firstBinHz,retainedStartBin:r.retainedStartBin,retainedEndBin:r.retainedEndBin,
      visibleFraction:r.visibleFraction,acquisitionFftSize:r.acquisitionFftSize,configuredFftSize:r.configuredFftSize,
      acquisitionWindow:r.acquisitionWindow,analysisWindow:r.analysisWindow,qualityScore:r.qualityScore,
      temporalFrameCount:r.temporalFrameCount,evidenceMs:r.evidenceMs,latencyMs:r.latencyMs,
      ruleScore:r.ruleScore,streamEpoch:r.streamEpoch,optionsRevision:r.optionsRevision,sourceSampleOffsetBytes:r.sourceSampleOffsetBytes,
    };});
    const output=path.resolve(a.out??path.join(base,'classifications.jsonl'));
    const summaryOutput=path.resolve(a.summary_out??`${output.replace(/\.jsonl$/i,'')}.summary.json`);
    if(output===summaryOutput) throw new Error('classification rows and summary must use different output paths');
    await writeFile(output,writeRows(rows));
    const summary=summarizeClassificationRows(rows,model.id);
    await writeFile(summaryOutput,`${JSON.stringify(summary,null,2)}\n`);
    console.log(JSON.stringify({rows:rows.length,ready:summary.totalReadyWindows,insufficientEvidence:summary.totalInsufficientEvidenceWindows,recordings:summary.recordings.length,modelId:model.id,output,summary:summaryOutput},null,2));
  } finally { await rm(copy,{force:true});await rm(temp,{force:true}); }
}
function help(){console.log(`Resolution-aware morphology classifier\n\n  node scripts/classifier/cli.mjs prepare --manifest manifest.json [--out /private/tmp/napt-classifier/prepared] [--env-file .env.local]\n  node --import tsx scripts/classifier/cli.mjs prepare --package capture-package-directory-or-zip --split train|validation|test|acceptance|unlabeled|challenge-mock|challenge-sinc [--session session-id] [--out /private/tmp/napt-classifier/prepared] [--env-file .env.local]\n  node scripts/classifier/cli.mjs extract --dataset prepared/dataset.json [--fft-sizes 1024,4096,16384] [--crops 0:1,0.25:0.75] [--window hann] [--max-frames 64]\n  node scripts/classifier/cli.mjs classify --input prepared/dataset.json --model model.json [--out classifications.jsonl] [--summary-out classifications.summary.json]\n  node --import tsx scripts/classifier/cli.mjs package --capture capture.iq --labels label-draft.json --out package-dir [--captured-at ISO-8601]\n  python3 scripts/classifier/train.py train --features features.jsonl --model model.json --report report.json\n  python3 scripts/classifier/train.py evaluate --features features.jsonl --split test|challenge-mock|challenge-sinc --model model.json --report report.json\n`);}
async function packageCapture(a){const {createCapturePackage}=await import('./package.mjs');const result=await createCapturePackage({capturePath:a.capture,labelsPath:a.labels,outputPath:a.out,capturedAt:a.captured_at});console.log(JSON.stringify(result,null,2));}
async function main(){const a=args(process.argv.slice(2)); if(a.command==='prepare')return prepare(a); if(a.command==='extract')return extract(a); if(a.command==='classify')return classify(a); if(a.command==='package')return packageCapture(a); if(a.command==='help'||!a.command)return help();throw new Error(`Unknown command: ${a.command}`);}
main().catch(error=>{console.error(`classifier: ${error.message}`);process.exitCode=2;});
