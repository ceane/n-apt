#!/usr/bin/env python3
"""Train/evaluate native morphology models from classifier feature JSONL."""
import argparse, hashlib, json, math, pathlib, sys
import numpy as np
FEATURE_NAMES = ['bridge','partialBridge','uDip','occupancy','peakDensity','spacingRegularity','width','prominence','envelopeVariation','quality','narrowAvailable','bridgeAvailable','envelopeAvailable','visibleFraction','validFraction','persistence','meanBridge','meanUDip']
PREPROCESSING = 'native-morphology-v1'

def check_splits(rows):
    seen = {}
    for r in rows:
        session, split = r.get('session'), r.get('split')
        if not session or split not in ('train','validation','test','acceptance','unlabeled'):
            raise ValueError('Every feature row requires a session and supported split')
        if session in seen and seen[session] != split: raise ValueError(f'Session leakage: {session}')
        seen[session] = split
    return True

def metrics(y_true, y_pred):
    y = np.asarray(y_true, dtype=int); p = np.asarray(y_pred, dtype=bool)
    tp = int(np.sum((y == 1) & p)); tn = int(np.sum((y == 0) & ~p))
    fp = int(np.sum((y == 0) & p)); fn = int(np.sum((y == 1) & ~p))
    positives, negatives = tp + fn, tn + fp
    recall = tp / positives if positives else None
    specificity = tn / negatives if negatives else None
    precision = tp / (tp + fp) if tp + fp else 0.0
    return {'count': int(y.size), 'tp': tp, 'tn': tn, 'fp': fp, 'fn': fn, 'precision': precision,
            'recall': recall, 'specificity': specificity,
            'balancedAccuracy': (recall + specificity) / 2 if recall is not None and specificity is not None else None}

def choose_threshold(y_true, scores):
    y = np.asarray(y_true, dtype=int); s = np.asarray(scores, dtype=float)
    if not y.size or y.size != s.size or not np.isfinite(s).all() or set(y.tolist()) != {0, 1}:
        raise ValueError('Threshold selection requires finite scores and both classes')
    candidates = sorted(set([0.0, 0.5, 1.0, *[(float(a) + float(b)) / 2 for a, b in zip(np.sort(s)[:-1], np.sort(s)[1:])]]))
    results = [(metrics(y, s >= t)['balancedAccuracy'], -abs(t - 0.5), t) for t in candidates]
    return max(results)[2]

def predict(model, x):
    x = np.asarray(x, dtype=float); z = (x - np.asarray(model['mean'])) / np.asarray(model['scale'])
    h = z @ np.asarray(model['weights']).T + np.asarray(model['bias'])
    if model['kind'] == 'mlp': h = np.maximum(h, 0) @ np.asarray(model['outputWeights']) + float(model['outputBias'])
    return 1 / (1 + np.exp(-np.clip(h.reshape(-1), -80, 80)))

def load_rows(path):
    rows = [json.loads(line) for line in pathlib.Path(path).read_text().splitlines() if line.strip()]
    check_splits(rows)
    for r in rows:
        if r.get('preprocessing') != PREPROCESSING or r.get('featureNames') != FEATURE_NAMES or len(r.get('features', [])) != len(FEATURE_NAMES):
            raise ValueError('Feature version/order does not match trainer')
        if not np.isfinite(np.asarray(r['features'], float)).all(): raise ValueError(f"Invalid feature row: {r.get('id')}")
    return rows

def usable(rows, split):
    return [r for r in rows if r['split'] == split and r.get('label') in ('matching','nonmatching')]

def balanced_weights(rows):
    # Equal total influence per recording session, then per class.
    sessions = {}
    for r in rows: sessions.setdefault(r['session'], []).append(r)
    weights = np.array([1 / len(sessions[r['session']]) / max(1, sum(x['label'] == r['label'] for x in rows if x['session'] == r['session'])) for r in rows])
    labels = np.array([r['label'] == 'matching' for r in rows])
    for label in (False, True):
        if labels.tolist().count(label): weights[labels == label] *= 0.5 / labels.tolist().count(label)
    return weights / weights.mean()

def fit_logistic(x, y, weight):
    mean = x.mean(0); scale = x.std(0); scale[scale < 1e-6] = 1
    z = np.clip((x - mean) / scale, -20, 20); w = np.zeros(z.shape[1]); b = 0.
    rate = 0.15
    for _ in range(4000):
        logits = np.clip(z @ w + b, -30, 30); pred = 1 / (1 + np.exp(-logits)); error = (pred-y) * weight
        grad = z.T @ error / len(y) + 1e-3*w; gb = error.mean()
        w -= rate * grad; b -= rate * gb
    return {'kind':'logistic','mean':mean.tolist(),'scale':scale.tolist(),'weights':[w.tolist()],'bias':[float(b)]}

def fit_mlp(x, y, weight, seed=1729, device='auto'):
    mean=x.mean(0); scale=x.std(0); scale[scale < 1e-6]=1
    z=np.clip((x-mean)/scale,-20,20)
    try: import torch
    except ImportError: torch=None
    if torch is not None and device != 'numpy':
        torch.manual_seed(seed)
        backend = 'mps' if torch.backends.mps.is_available() else 'cpu'
        if device == 'mps' and backend != 'mps': raise RuntimeError('PyTorch MPS was explicitly requested but is unavailable')
        backend = device if device in ('cpu','mps') else backend
        tx=torch.tensor(z,dtype=torch.float32,device=backend); ty=torch.tensor(y[:,None],dtype=torch.float32,device=backend); tw=torch.tensor(weight[:,None],dtype=torch.float32,device=backend)
        model=torch.nn.Sequential(torch.nn.Linear(x.shape[1],16),torch.nn.ReLU(),torch.nn.Linear(16,1)).to(backend)
        optimizer=torch.optim.Adam(model.parameters(),lr=0.01,weight_decay=0.001)
        for _ in range(1400):
            optimizer.zero_grad(); logits=model(tx); loss=(torch.nn.functional.binary_cross_entropy_with_logits(logits,ty,reduction='none')*tw).mean(); loss.backward(); optimizer.step()
        first,last=list(model)
        return {'kind':'mlp','mean':mean.tolist(),'scale':scale.tolist(),'weights':first.weight.detach().cpu().numpy().tolist(),
                'bias':first.bias.detach().cpu().numpy().tolist(),'outputWeights':last.weight.detach().cpu().numpy()[0].tolist(),
                'outputBias':float(last.bias.detach().cpu().numpy()[0]),'trainingDevice':backend}
    rng=np.random.default_rng(seed); w1=rng.normal(0,0.08,(16,z.shape[1])); b1=np.zeros(16); w2=rng.normal(0,0.08,16); b2=0.
    params=[w1,b1,w2,np.array([b2])]; first=[np.zeros_like(p) for p in params]; second=[np.zeros_like(p) for p in params]
    for step in range(1,1201):
        pre=z@w1.T+b1; hidden=np.maximum(pre,0); logits=hidden@w2+b2; pred=1/(1+np.exp(-np.clip(logits,-30,30)))
        dlogit=((pred-y)*weight)/len(y); dw2=hidden.T@dlogit+1e-3*w2; db2=np.array([dlogit.sum()]); dpre=(dlogit[:,None]*w2)*(pre>0)
        grads=[dpre.T@z+1e-3*w1,dpre.sum(0),dw2,db2]
        for i,(param,grad) in enumerate(zip(params,grads)):
            first[i]=0.9*first[i]+0.1*grad; second[i]=0.999*second[i]+0.001*grad*grad
            param -= 0.02*(first[i]/(1-0.9**step))/(np.sqrt(second[i]/(1-0.999**step))+1e-8)
    return {'kind':'mlp','mean':mean.tolist(),'scale':scale.tolist(),'weights':w1.tolist(),'bias':b1.tolist(),
            'outputWeights':w2.tolist(),'outputBias':float(b2),'trainingDevice':'numpy'}

def write_json(path, value):
    p=pathlib.Path(path); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')

def train_command(args):
    rows=load_rows(args.features); tr=usable(rows,'train'); va=usable(rows,'validation')
    if not tr or not va or {r['label'] for r in tr}!={'matching','nonmatching'} or {r['label'] for r in va}!={'matching','nonmatching'}: raise ValueError('Train and validation splits each require both explicit labels')
    x=np.asarray([r['features'] for r in tr],float); y=np.asarray([r['label']=='matching' for r in tr],float); wt=balanced_weights(tr)
    vx=np.asarray([r['features'] for r in va],float); vy=np.asarray([r['label']=='matching' for r in va],int)
    candidates=[]
    for kind, fit in [('logistic',fit_logistic),('mlp',lambda a,b,c: fit_mlp(a,b,c,device=args.device))]:
        params=fit(x,y,wt); scores=predict(params,vx); threshold=choose_threshold(vy,scores)
        candidates.append(({**params,'version':1,'preprocessing':PREPROCESSING,'featureNames':FEATURE_NAMES,'threshold':threshold,
          'validatedSampleRatesHz':sorted(set(r['analysisSampleRateHz'] for r in va)),
          'trainingSessions':sorted(set(r['session'] for r in tr)),'validationSessions':sorted(set(r['session'] for r in va))}, metrics(vy,scores>=threshold)))
    candidates.sort(key=lambda x: ((x[1]['balancedAccuracy'] if x[1]['balancedAccuracy'] is not None else -1), x[0]['kind']=='logistic'),reverse=True)
    model=candidates[0][0]; canonical=json.dumps(model,sort_keys=True,separators=(',',':')); model['id']=hashlib.sha256(canonical.encode()).hexdigest()[:16]
    write_json(args.model,model); write_json(args.report,{'selectedModel':model['kind'],'validation':candidates[0][1],'candidates':[{'kind':m['kind'],'validation':report} for m,report in candidates], 'trainingRows':len(tr),'validationRows':len(va),'testRows':len(usable(rows,'test')),'syntheticOnly':all(r.get('syntheticOnly') for r in rows)})

def evaluate_command(args):
    rows=load_rows(args.features); split=args.split; selected=usable(rows,split)
    if not selected: raise ValueError(f'No labeled {split} rows')
    report={'split':split,'byRecording':{},'bySession':{},'byResolution':{},'byVisibility':{},'overall':None,'insufficientEvidenceRows':sum(r.get('status')!='ready' for r in rows if r['split']==split)}
    model=json.loads(pathlib.Path(args.model).read_text()) if args.model else None
    for r in selected:
        score=float(predict(model,[r['features']])[0]) if model else float(r.get('ruleScore',0))
        r['_pred']=score >= (model['threshold'] if model else args.threshold)
    report['overall']=metrics([r['label']=='matching' for r in selected],[r['_pred'] for r in selected])
    for key,label in [('id','byRecording'),('session','bySession'),('fftSize','byResolution'),('visibleFraction','byVisibility')]:
        groups={}
        for r in selected: groups.setdefault(str(r.get(key,'unknown')),[]).append(r)
        report[label]={k:metrics([r['label']=='matching' for r in rs],[r['_pred'] for r in rs]) for k,rs in groups.items()}
    write_json(args.report,report)

def main():
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('train'); p.add_argument('--features',required=True); p.add_argument('--model',required=True); p.add_argument('--report',required=True); p.add_argument('--device',choices=['auto','numpy','cpu','mps'],default='auto'); p.set_defaults(run=train_command)
    p=sub.add_parser('evaluate'); p.add_argument('--features',required=True); p.add_argument('--split',choices=['validation','test','acceptance'],default='test'); p.add_argument('--model'); p.add_argument('--threshold',type=float,default=0.5); p.add_argument('--report',required=True); p.set_defaults(run=evaluate_command)
    args=parser.parse_args(); args.run(args)
if __name__=='__main__':
    try: main()
    except Exception as error: print(f'classifier: {error}',file=sys.stderr); sys.exit(2)
