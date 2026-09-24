#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRunner } from './runner.mjs';
import { decodeIq, spectrumFromIq, validateDataset, selectFrameIndices, readTrainingCapture } from './io.mjs';
import { FEATURE_NAMES, PREPROCESSING, validateModel, inferModel } from '../../src/ts/features/classification/native/core.ts';
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
    if(m.capture_metadata?.sample_rate_hz && Math.abs(Number(m.capture_metadata.sample_rate_hz)-record.sampleRateHz)>1) throw new Error(`Declared sample rate disagrees with ${record.id} capture metadata`);
    return { bytes: await readFile(path.join(output,'raw.iq.u8')), format:'u8', manifest: record };
  } finally { await rm(temp,{recursive:true,force:true}); }
}
async function writePreparedIq(iq, directory) {
  await mkdir(directory, { recursive: true });
  const raw=Buffer.alloc(iq.length*4); for(let i=0;i<iq.length;i++) raw.writeFloatLE(iq[i],4*i);
  const input=path.join(directory,'raw.iq.f32le'); await writeFile(input,raw); return input;
}
async function prepare(a) {
  if(!a.manifest) throw new Error('prepare requires --manifest JSON; labels/splits are explicit');
  const manifestPath=path.resolve(a.manifest), base=path.dirname(manifestPath), dataset=validateDataset(JSON.parse(await readFile(manifestPath,'utf8')));
  const out=path.resolve(a.out ?? '/private/tmp/napt-classifier/prepared'); await mkdir(out,{recursive:true});
  const records=[];
  for(const r of dataset.recordings) {
    if(r.format==='browser-capture') {
      const rawCapture=JSON.parse(await readFile(path.resolve(base,r.input),'utf8'));
      const sidecar=r.annotations ? JSON.parse(await readFile(path.resolve(base,r.annotations),'utf8')) : null;
      const capture=readTrainingCapture(rawCapture,sidecar);
      const config=capture.config;
      if(Math.abs(config.sampleRateHz-r.sampleRateHz)>1 || Math.abs(config.centerFrequencyHz-r.centerFrequencyHz)>1) throw new Error(`${r.id}: declared sample rate or center frequency disagrees with browser capture metadata`);
      for(const frame of capture.frames) {
        const id=`${r.id}_seq${frame.sequence}`;
        const iq=decodeIq(frame.iqBytes,'u8');
        const input=await writePreparedIq(iq,path.join(out,id));
        records.push({...r,id,input:path.relative(out,input),format:'f32le',captureId:r.id,browserSessionId:capture.sessionId,captureAnnotations:capture.annotations,annotationEvents:capture.annotationEvents,interferenceMarkedEvents:capture.interferenceMarkedEvents,tuneEvents:capture.tuneEvents,optionsAppliedEvents:capture.optionsAppliedEvents,streamInterruptedEvents:capture.streamInterruptedEvents,stopReason:capture.stopReason,sourceId:config.sourceId,streamEpoch:frame.streamEpoch,frameSequence:frame.sequence,timestampStartMs:frame.timestampMs,configuredFftSize:config.configuredFftSize,analysisFftSize:config.fftSize,window:config.window,temporalResolution:config.temporalResolution,validSamples:frame.validSamples,iqByteCount:frame.iqBytes.length,complexSamples:iq.length/2});
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
  const runner=await createRunner(), rows=[];
  try {
    for(const r of dataset.recordings) {
      const iq=decodeIq(await readFile(path.resolve(base,r.input)),'f32le'), n=iq.length/2;
      for(const fftSize of sizes) {
        for(const [startFraction,endFraction] of crops) {
          const hop=Math.max(1,Math.floor(fftSize/2)), totalFrames=Math.max(1,Math.ceil(Math.max(1,n-fftSize)/hop)+1), frameIndices=selectFrameIndices(totalFrames, Number(a.max_frames??64));
          const temporal=[]; const streamKey=`${r.id}:${fftSize}:${startFraction}:${endFraction}:${window}`;
          for(let f=0;f<frameIndices.length;f++) {
            const sourceFrameIndex=frameIndices[f], start=sourceFrameIndex*hop, valid=Math.min(fftSize,n-start); if(valid<2) break;
            const chunk=iq.subarray(start*2,(start+valid)*2), fft=spectrumFromIq(chunk,fftSize,window);
            const startBin=Math.floor(startFraction*fft.fftSize), endBin=Math.max(startBin+1,Math.floor(endFraction*fft.fftSize));
            const spectrum=fft.spectrum.subarray(startBin,endBin);
            const timestampMs=Number(r.timestampStartMs??0)+start/r.sampleRateHz*1000;
            const metadata={sourceId:streamKey,frameId:`${r.id}:${fftSize}:${startFraction}:${start}`,timestampMs,acquisitionSampleRateHz:r.sampleRateHz,analysisSampleRateHz:r.sampleRateHz,fftSize:fft.fftSize,validSamples:fft.validSamples,window,centerFrequencyHz:r.centerFrequencyHz,retainedStartBin:startBin,retainedEndBin:endBin};
            const result=await runner.extract(Array.from(spectrum),metadata);
            if(result) temporal.push({id:r.id,captureId:r.captureId??r.id,recordingId:r.id,session:r.session,split:r.split,label:r.label,captureAnnotations:r.captureAnnotations??null,annotationEvents:r.annotationEvents??[],interferenceMarkedEvents:r.interferenceMarkedEvents??[],tuneEvents:r.tuneEvents??[],optionsAppliedEvents:r.optionsAppliedEvents??[],streamInterruptedEvents:r.streamInterruptedEvents??[],stopReason:r.stopReason??null,preprocessing:PREPROCESSING,featureNames:FEATURE_NAMES,features:result.values,status:result.status,available:result.available,ruleScore:result.ruleScore,fftSize:metadata.fftSize,validSamples:metadata.validSamples,sampleRateHz:r.sampleRateHz,analysisSampleRateHz:r.sampleRateHz,binHz:r.sampleRateHz/metadata.fftSize,firstBinHz:r.centerFrequencyHz-r.sampleRateHz/2+startBin*r.sampleRateHz/metadata.fftSize,retainedStartBin:startBin,retainedEndBin:endBin,visibleFraction:spectrum.length/metadata.fftSize,window,frameIndex:sourceFrameIndex,timestampMs,evidenceMs:result.evidenceMs,sourceId:r.sourceId??null,streamEpoch:r.streamEpoch??null,frameSequence:r.frameSequence??null,configuredFftSize:r.configuredFftSize??null,analysisFftSize:r.analysisFftSize??null});
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
    const rows=readJsonLines(await readFile(temp,'utf8')).map(r=>{const score=inferModel(model,r.features);return {id:r.id,session:r.session,frameIndex:r.frameIndex,timestampMs:r.timestampMs,score,decision:r.status==='ready'?score>=model.threshold:null,status:r.status,available:r.available,sampleRateHz:r.sampleRateHz,rateValidated:model.validatedSampleRatesHz.includes(r.sampleRateHz),fftSize:r.fftSize,binHz:r.binHz,visibleFraction:r.visibleFraction,ruleScore:r.ruleScore};});
    await writeFile(path.resolve(a.out??path.join(base,'classifications.json')),writeRows(rows));
    const classified=rows.filter(r=>r.decision!==null); console.log(JSON.stringify({rows:rows.length,insufficientEvidence:rows.length-classified.length,modelId:model.id,output:a.out??path.join(base,'classifications.json')},null,2));
  } finally { await rm(copy,{force:true});await rm(temp,{force:true}); }
}
function help(){console.log(`Resolution-aware morphology classifier\n\n  node scripts/classifier/cli.mjs prepare --manifest manifest.json [--out /private/tmp/napt-classifier/prepared] [--env-file .env.local]\n  node scripts/classifier/cli.mjs extract --dataset prepared/dataset.json [--fft-sizes 1024,4096,16384] [--crops 0:1,0.25:0.75] [--window hann] [--max-frames 64]\n  node scripts/classifier/cli.mjs classify --input prepared/dataset.json --model model.json [--out classifications.jsonl]\n  python3 scripts/classifier/train.py train --features features.jsonl --model model.json --report report.json\n  python3 scripts/classifier/train.py evaluate --features features.jsonl --split test --model model.json --report report.json\n`);}
async function main(){const a=args(process.argv.slice(2)); if(a.command==='prepare')return prepare(a); if(a.command==='extract')return extract(a); if(a.command==='classify')return classify(a); if(a.command==='help'||!a.command)return help();throw new Error(`Unknown command: ${a.command}`);}
main().catch(error=>{console.error(`classifier: ${error.message}`);process.exitCode=2;});
