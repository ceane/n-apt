import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

const repo = path.resolve(import.meta.dirname, '../..');
async function isolatedProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'napt-security-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  return root;
}

test('setup never prints existing credentials and preserves their bytes', async t => {
  const root = await isolatedProject(t);
  await fs.cp(path.join(repo, 'scripts/setup'), path.join(root, 'scripts/setup'), { recursive: true });
  const original = 'UNSAFE_LOCAL_USER_PASSWORD=FAKE_SECRET_DO_NOT_PRINT\nOPEN_CELL_ID_ACCESS_TOKEN=FAKE_API_TOKEN\n';
  await fs.writeFile(path.join(root, '.env.local'), original);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/setup/create_env.js')], { encoding:'utf8' });
  assert.equal(result.status, 0);
  assert.equal(await fs.readFile(path.join(root, '.env.local'), 'utf8'), original);
  assert.doesNotMatch(result.stdout + result.stderr, /FAKE_SECRET_DO_NOT_PRINT|FAKE_API_TOKEN/);
});

test('setup removes the Vite password alias without losing a distinct legacy capture key', async t => {
  const root = await isolatedProject(t);
  await fs.cp(path.join(repo, 'scripts/setup'), path.join(root, 'scripts/setup'), { recursive: true });
  const original = 'UNSAFE_LOCAL_USER_PASSWORD=backend-key\nVITE_UNSAFE_LOCAL_USER_PASSWORD=legacy-capture-key\n';
  await fs.writeFile(path.join(root, '.env.local'), original);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/setup/create_env.js')], { encoding:'utf8' });
  assert.equal(result.status, 0);
  const env = await fs.readFile(path.join(root, '.env.local'), 'utf8');
  assert.match(env, /^UNSAFE_LOCAL_USER_PASSWORD=backend-key$/m);
  assert.match(env, /^NAPT_LEGACY_CAPTURE_PASSWORD=legacy-capture-key$/m);
  assert.doesNotMatch(env, /^VITE_UNSAFE_LOCAL_USER_PASSWORD=/m);
  assert.doesNotMatch(result.stdout + result.stderr, /backend-key|legacy-capture-key/);
});

test('setup removes a duplicate Vite alias when it matches the backend password', async t => {
  const root = await isolatedProject(t);
  await fs.cp(path.join(repo, 'scripts/setup'), path.join(root, 'scripts/setup'), { recursive: true });
  const original = 'UNSAFE_LOCAL_USER_PASSWORD=same-local-key\nVITE_UNSAFE_LOCAL_USER_PASSWORD=same-local-key\n';
  await fs.writeFile(path.join(root, '.env.local'), original);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/setup/create_env.js')], { encoding:'utf8' });
  assert.equal(result.status, 0);
  const env = await fs.readFile(path.join(root, '.env.local'), 'utf8');
  assert.match(env, /^UNSAFE_LOCAL_USER_PASSWORD=same-local-key$/m);
  assert.doesNotMatch(env, /^VITE_UNSAFE_LOCAL_USER_PASSWORD=/m);
  assert.doesNotMatch(env, /^NAPT_LEGACY_CAPTURE_PASSWORD=/m);
  assert.doesNotMatch(result.stdout + result.stderr, /same-local-key/);
});

test('setup promotes the Vite alias when it is the only local login password', async t => {
  const root = await isolatedProject(t);
  await fs.cp(path.join(repo, 'scripts/setup'), path.join(root, 'scripts/setup'), { recursive: true });
  const original = 'VITE_UNSAFE_LOCAL_USER_PASSWORD=old-login-key\n';
  await fs.writeFile(path.join(root, '.env.local'), original);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/setup/create_env.js')], { encoding:'utf8' });
  assert.equal(result.status, 0);
  const env = await fs.readFile(path.join(root, '.env.local'), 'utf8');
  assert.match(env, /^UNSAFE_LOCAL_USER_PASSWORD=old-login-key$/m);
  assert.doesNotMatch(env, /^VITE_UNSAFE_LOCAL_USER_PASSWORD=/m);
  assert.doesNotMatch(result.stdout + result.stderr, /old-login-key/);
});

test('setup fails closed when migrating would overwrite a different legacy capture password', async t => {
  const root = await isolatedProject(t);
  await fs.cp(path.join(repo, 'scripts/setup'), path.join(root, 'scripts/setup'), { recursive: true });
  const original = 'UNSAFE_LOCAL_USER_PASSWORD=backend-key\nNAPT_LEGACY_CAPTURE_PASSWORD=existing-capture-key\nVITE_UNSAFE_LOCAL_USER_PASSWORD=second-capture-key\n';
  await fs.writeFile(path.join(root, '.env.local'), original);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/setup/create_env.js')], { encoding:'utf8' });
  assert.equal(result.status, 1);
  assert.equal(await fs.readFile(path.join(root, '.env.local'), 'utf8'), original);
  assert.doesNotMatch(result.stdout + result.stderr, /backend-key|existing-capture-key|second-capture-key/);
});

test('encryption e2e script leaves an existing local env file intact on early failure', async t => {
  const root = await isolatedProject(t);
  const original = 'UNSAFE_LOCAL_USER_PASSWORD=FAKE_EXISTING_CAPTURE_KEY\nNAPT_PBKDF2_SALT=FAKE_EXISTING_SALT\n';
  await fs.writeFile(path.join(root, '.env.local'), original);
  const result = spawnSync('/bin/bash', [path.join(repo, 'test/integration/run-encryption-e2e.sh')], {
    cwd: root,
    env: { ...process.env, PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'the script should stop when Cargo is unavailable');
  assert.equal(await fs.readFile(path.join(root, '.env.local'), 'utf8'), original);
});

test('new setup uses an unpredictable password and private file permissions', async t => {
  const root = await isolatedProject(t);
  await fs.cp(path.join(repo, 'scripts/setup'), path.join(root, 'scripts/setup'), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/setup/create_env.js')], { encoding:'utf8' });
  assert.equal(result.status, 0);
  const env = await fs.readFile(path.join(root, '.env.local'), 'utf8');
  const password = env.match(/^UNSAFE_LOCAL_USER_PASSWORD=(.+)$/m)[1];
  assert.notEqual(password, 'your_password');
  assert.ok(password.length >= 32);
  assert.equal((await fs.stat(path.join(root, '.env.local'))).mode & 0o777, 0o600);
  assert.match(env, /^UNSAFE_LOCAL_USER_PASSWORD=/m);
  assert.doesNotMatch(env, /^VITE_UNSAFE_LOCAL_USER_PASSWORD=/m);
  assert.ok(!result.stdout.includes(password));
});

test('archive mention output cannot inject HTML or event handlers', async () => {
  let output;
  const context = { self: { postMessage: value => { output = value; } } };
  vm.createContext(context);
  vm.runInContext(await fs.readFile(path.join(repo, 'src/app-legal/workers/transcriptWorker.ts'), 'utf8'), context);
  context.self.onmessage({ data: {
    tweets: [{ tweet: { id_str:'1', full_text:'Safe #tag @name', created_at:'2026-01-01', entities:{user_mentions:[
      {screen_name:'\"><img src=x onerror="alert(1)">'}, {screen_name:'b'}, {screen_name:'c'}, {screen_name:'d'}
    ]} } }], filters:{filterRetweets:false,filterNonReplyLinks:false,keywords:[],dateRanges:[]},
    searchQuery:'',currentPage:1,tweetsPerPage:50,selectedIds:[]
  } });
  const html = output.pageTweets[0].mentionDisplay ?? '';
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelectorAll('img,script,[onerror],[onclick]').length, 0);
  const tweetDocument = new JSDOM(output.pageTweets[0].htmlText).window.document;
  const hashtagLink = tweetDocument.querySelector('a[href]');
  assert.ok(hashtagLink, 'the hashtag should render as a link');
  const hashtagUrl = new URL(hashtagLink.href);
  assert.equal(hashtagUrl.protocol, 'https:');
  assert.equal(hashtagUrl.hostname, 'twitter.com');
  assert.equal(hashtagUrl.pathname, '/hashtag/tag');
});

async function archiveServer(t) {
  const root = await isolatedProject(t);
  await fs.cp(path.join(repo, 'scripts/legal-app-server'), path.join(root, 'scripts/legal-app-server'), { recursive:true });
  const backend = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    let token; try { token = JSON.parse(body).token; } catch {}
    res.writeHead(token === 'valid-test-token' ? 200 : 401, {'Content-Type':'application/json'});
    res.end(JSON.stringify({valid:token === 'valid-test-token'}));
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => new Promise(resolve => {backend.closeAllConnections();backend.close(resolve);}));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(root, 'scripts/legal-app-server/index.mjs')], {
    cwd:root, env:{...process.env,PORT:String(port),NAPT_BACKEND_PROXY_URL:`http://127.0.0.1:${backend.address().port}`,
      NAPT_ARCHIVE_MAX_UPLOAD_BYTES:'1024', NAPT_ARCHIVE_MAX_EXPANDED_BYTES:'4096', NAPT_ARCHIVE_MAX_ENTRIES:'8'},
    stdio:['ignore','pipe','pipe']
  });
  t.after(async () => { if(child.exitCode === null) {child.kill();await once(child,'exit');} });
  let output = ''; child.stdout.on('data', chunk => {output += chunk;}); child.stderr.on('data',chunk => {output += chunk;});
  for(let i=0;i<100;i++) {
    if (output.includes('Transcript API running')) return {root,base:`http://127.0.0.1:${port}`};
    if(child.exitCode !== null) throw new Error(output);
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  throw new Error(`Archive server startup timed out: ${output}`);
}
const headers = {Authorization:'Bearer valid-test-token'};
async function upload(base, bytes, name='archive.zip') {
  const form = new FormData(); form.append('archive',new Blob([bytes]),name);
  return fetch(`${base}/api/archives/upload`,{method:'POST',headers,body:form});
}

test('archive API requires a backend session before reading or parsing uploads', async t => {
  const {base} = await archiveServer(t);
  assert.equal((await fetch(`${base}/api/archives`)).status,401);
  assert.equal((await fetch(`${base}/api/archives`,{headers})).status,200);
  assert.equal((await fetch(`${base}/api/archives/upload`,{method:'POST',body:'bad',headers:{'Content-Type':'multipart/form-data'}})).status,401);
});

test('archive upload limits, bounded extraction and successful archive reading', async t => {
  const {base} = await archiveServer(t);
  assert.equal((await upload(base, Buffer.alloc(2048))).status,413);
  const zip = new AdmZip(); zip.addFile('data/tweets.js',Buffer.from('window.YTD.tweets.part0 = [{"tweet":{"id_str":"1","full_text":"hello"}}]'));
  const response = await upload(base,zip.toBuffer()); assert.equal(response.status,200);
  const {name} = await response.json();
  const second = await upload(base,zip.toBuffer()); assert.equal(second.status,200);
  assert.notEqual((await second.json()).name,name,'uploads must not overwrite other archives');
  const extract = await fetch(`${base}/api/archives/extract`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({archiveName:name})});
  assert.equal(extract.status,200);
  const archive = name.replace(/\.zip$/i,'');
  const tweets = await fetch(`${base}/api/archives/${encodeURIComponent(archive)}/tweets`,{headers});
  assert.equal(tweets.status,200); assert.equal((await tweets.json())[0].tweet.full_text,'hello');
  const exported = await fetch(`${base}/api/export`, {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({archiveName:archive,filteredTweetIds:['1']})});
  assert.equal(exported.status,200);
  const result = await exported.json();
  const download = await fetch(`${base}/api/download/${encodeURIComponent(result.zipPath)}`,{headers});
  assert.equal(download.status,200);
  const downloadedZip = new AdmZip(Buffer.from(await download.arrayBuffer()));
  assert.ok(downloadedZip.readAsText('data/tweets.js').includes('hello'));
  assert.equal((await fetch(`${base}/api/download/${encodeURIComponent(result.zipPath)}`)).status,401);
  const bomb = new AdmZip(); bomb.addFile('big.txt',Buffer.alloc(8192));
  const bombUpload = await upload(base,bomb.toBuffer(),'bomb.zip'); assert.equal(bombUpload.status,200);
  const bombName = (await bombUpload.json()).name;
  const reject = await fetch(`${base}/api/archives/extract`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({archiveName:bombName})});
  assert.equal(reject.status,413);
});

test('archive extraction rejects traversal, links and excessive entry counts', async t => {
  const {base,root} = await archiveServer(t);
  for (const [name,zip] of [
    ['traversal', (()=>{const z=new AdmZip();z.addFile('safe.txt',Buffer.from('escape'));z.getEntry('safe.txt').entryName='../escape.txt';return z;})()],
    ['symlink', (()=>{const z=new AdmZip();z.addFile('link',Buffer.from('/etc/passwd'));z.getEntry('link').header.attr=(0o120777<<16)>>>0;return z;})()],
    ['many', (()=>{const z=new AdmZip();for(let i=0;i<9;i++)z.addFile(`f${i}`,Buffer.from('x'));return z;})()],
  ]) {
    const response=await upload(base,zip.toBuffer(),`${name}.zip`);assert.equal(response.status,200);
    const archiveName=(await response.json()).name;
    const extract=await fetch(`${base}/api/archives/extract`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({archiveName})});
    assert.equal(extract.status,name==='many'?413:400);
  }
  assert.equal((await fs.readdir(path.join(root,'scripts/archives'))).filter(name=>name.startsWith('.extract-')).length,0);
});
