/**
 * Single-page UI for the parity compliance checker. Self-contained (inline CSS +
 * JS, no external assets). Drag-and-drop upload, tag each file, choose mode
 * (as-written vs everything), Check → flagged issues rendered in an isolated
 * iframe. Files are read to base64 in the browser and POSTed; the BACKEND parses
 * every file type. Runs locally — uploaded data never leaves the machine.
 */
export function renderAppPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fidvciary — Parity Compliance Checker</title>
<style>
:root{--ink:#1e2430;--muted:#5b6472;--line:#e4e7ec;--bg:#eef1f5;--card:#fff;--accent:#1f4e79;--accent2:#2a6fb0;--ok:#1a7f43}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:32px 20px 64px}
header h1{font-size:24px;margin:0 0 4px;letter-spacing:-.01em}
header p{color:var(--muted);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px 24px;margin:16px 0;box-shadow:0 1px 3px rgba(16,24,40,.05)}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 12px}
.modes{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.mode{border:2px solid var(--line);border-radius:10px;padding:16px;cursor:pointer;transition:.15s}
.mode:hover{border-color:#c7d2e0}
.mode.sel{border-color:var(--accent2);background:#f5f9fd}
.mode h3{margin:0 0 4px;font-size:15px}
.mode p{margin:0;font-size:13px;color:var(--muted)}
.drop{border:2px dashed #c2ccd8;border-radius:10px;padding:28px;text-align:center;color:var(--muted);cursor:pointer;transition:.15s}
.drop.over{border-color:var(--accent2);background:#f5f9fd;color:var(--accent)}
.drop b{color:var(--ink)}
.files{list-style:none;margin:14px 0 0;padding:0}
.file{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin:8px 0}
.file .nm{flex:1;font-size:14px;word-break:break-all}
.file select{font:13px inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:#fff}
.file .rm{border:none;background:none;color:#b3261e;cursor:pointer;font-size:18px;line-height:1}
.row{display:flex;gap:20px;flex-wrap:wrap;align-items:center;margin-top:8px}
.row label{font-size:13px;color:var(--muted)}
select,input[type=text]{font:14px inherit;padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:#fff}
.actions{display:flex;align-items:center;gap:14px;margin-top:8px}
button.go{background:var(--accent);color:#fff;border:none;border-radius:9px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer}
button.go:disabled{background:#9fb2c6;cursor:not-allowed}
.hint{font-size:13px;color:var(--muted)}
.spinner{display:none;width:18px;height:18px;border:3px solid #cdd6e2;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#result{width:100%;border:1px solid var(--line);border-radius:12px;background:#fff;margin-top:20px;display:none}
.err{color:#b3261e;font-size:14px;margin-top:10px}
.note{font-size:12px;color:var(--muted);margin-top:18px}
</style></head><body><div class="wrap">
<header>
  <h1>Parity Compliance Checker</h1>
  <p>Upload a plan and flag where it may lack MHPAEA mental-health parity. Runs locally — your files never leave this machine.</p>
</header>

<div class="card">
  <h2>1 · What do you want to check?</h2>
  <div class="modes">
    <div class="mode sel" data-scope="as-written" onclick="pickMode(this)">
      <h3>As-written only</h3><p>Upload the benefits plan (and/or schedule of benefits). Flags the plan language.</p>
    </div>
    <div class="mode" data-scope="everything" onclick="pickMode(this)">
      <h3>Everything (in-operation)</h3><p>Also upload de-identified claims data to flag outcome disparities.</p>
    </div>
  </div>
</div>

<div class="card">
  <h2>2 · Upload files</h2>
  <div id="drop" class="drop" onclick="document.getElementById('fi').click()">
    <b>Drag &amp; drop</b> or click to choose — PDF, DOCX, TXT, CSV, XLSX all work.
  </div>
  <input id="fi" type="file" multiple style="display:none" onchange="addFiles(this.files)">
  <ul id="files" class="files"></ul>
  <p class="hint" id="claimsHint" style="display:none">In-operation mode: include a <b>claims</b> file (CSV/XLSX). It is checked for PHI and rejected if any is present.</p>
</div>

<div class="card">
  <h2>3 · Options</h2>
  <div class="row">
    <label>Thoroughness
      <select id="sensitivity">
        <option value="balanced" selected>Standard</option>
        <option value="aggressive">Thorough — flag any possible gap</option>
        <option value="conservative">Conservative — high-confidence only</option>
      </select>
    </label>
    <label>Jurisdiction (state)
      <input id="jurisdiction" type="text" value="CT" size="6" maxlength="2" style="text-transform:uppercase">
    </label>
  </div>
  <div class="actions">
    <button class="go" id="go" disabled onclick="run()">Check compliance</button>
    <div class="spinner" id="sp"></div>
    <span class="hint" id="status"></span>
  </div>
  <div class="err" id="err"></div>
</div>

<iframe id="result" title="Results"></iframe>
<p class="note">This tool flags potential parity issues for review. It is not legal advice and does not, by itself, satisfy the MHPAEA comparative-analysis requirement.</p>

<script>
let scope='as-written';
const files=[]; // {name, kind, b64}
const KINDS=[['plan_document','Plan document (SPD/wrap)'],['schedule_of_benefits','Schedule of benefits'],['claims','Claims data'],['prior_auth','Prior-auth log'],['appeals','Appeals log'],['network','Network directory'],['reimbursement','Reimbursement / fee schedule']];
function pickMode(el){document.querySelectorAll('.mode').forEach(m=>m.classList.remove('sel'));el.classList.add('sel');scope=el.dataset.scope;document.getElementById('claimsHint').style.display=scope==='everything'?'block':'none';}
function guessKind(n){n=n.toLowerCase();if(/\\.(csv|tsv|xlsx|xls)$/.test(n)){if(/prior|precert|preauth/.test(n))return 'prior_auth';if(/appeal/.test(n))return 'appeals';if(/network|roster|directory/.test(n))return 'network';if(/fee|reimburse|rate/.test(n))return 'reimbursement';return 'claims';}if(/schedule.*benefit|summary.*benefit|\\bsob\\b|sbc/.test(n))return 'schedule_of_benefits';return 'plan_document';}
function addFiles(list){[...list].forEach(f=>{const r=new FileReader();r.onload=()=>{files.push({name:f.name,kind:guessKind(f.name),b64:r.result.split(',')[1]});render();};r.readAsDataURL(f);});}
function render(){const ul=document.getElementById('files');ul.innerHTML='';files.forEach((f,i)=>{const li=document.createElement('li');li.className='file';li.innerHTML='<span class="nm">'+f.name+'</span>'+'<select onchange="files['+i+'].kind=this.value">'+KINDS.map(k=>'<option value="'+k[0]+'"'+(k[0]===f.kind?' selected':'')+'>'+k[1]+'</option>').join('')+'</select>'+'<button class="rm" onclick="files.splice('+i+',1);render()">×</button>';ul.appendChild(li);});document.getElementById('go').disabled=files.length===0;}
const dz=document.getElementById('drop');
['dragover','dragenter'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('over');}));
['dragleave','drop'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.remove('over');}));
dz.addEventListener('drop',ev=>addFiles(ev.dataTransfer.files));
async function run(){
  const go=document.getElementById('go'),sp=document.getElementById('sp'),st=document.getElementById('status'),err=document.getElementById('err');
  err.textContent='';go.disabled=true;sp.style.display='inline-block';st.textContent='Analyzing '+files.length+' file(s)…';
  try{
    const body={scope,sensitivity:document.getElementById('sensitivity').value,jurisdiction:(document.getElementById('jurisdiction').value||'federal'),files:files.map(f=>({name:f.name,kind:f.kind,base64:f.b64}))};
    const res=await fetch('/api/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!res.ok){throw new Error('Server error '+res.status+': '+(await res.text()).slice(0,300));}
    const data=await res.json();
    const fr=document.getElementById('result');fr.style.display='block';fr.srcdoc=data.html;
    fr.onload=()=>{try{fr.style.height=(fr.contentWindow.document.body.scrollHeight+40)+'px';}catch(e){fr.style.height='80vh';}};
    st.textContent=data.issueCount+' issue(s) flagged.';fr.scrollIntoView({behavior:'smooth'});
  }catch(e){err.textContent=e.message;st.textContent='';}
  finally{go.disabled=false;sp.style.display='none';}
}
</script>
</div></body></html>`;
}
