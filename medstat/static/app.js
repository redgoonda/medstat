/* ═══════════════════════════════════════════════════════════════
   MedStat — frontend logic
   ═══════════════════════════════════════════════════════════════ */
'use strict';

// ── Palette ────────────────────────────────────────────────────────
const COLORS = ['#1d4ed8','#16a34a','#dc2626','#d97706','#7c3aed','#0e7490'];
const LAYOUT_BASE = {
  margin: {t:30,r:20,b:50,l:60},
  paper_bgcolor:'#fff', plot_bgcolor:'#f8fafc',
  font: {family:'Segoe UI,system-ui,sans-serif', size:12},
  legend: {bgcolor:'#fff', bordercolor:'#e5e7eb', borderwidth:1},
};
const PLOTLY_CFG = {responsive:true, displayModeBar:true, displaylogo:false,
  modeBarButtonsToRemove:['lasso2d','select2d']};

// ── Utility ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = (v, d=3) => (v == null ? 'N/A' : (typeof v==='number' ? v.toFixed(d) : v));
const pFmt = p => p == null ? 'N/A' : (p < 0.001 ? '< 0.001' : p.toFixed(4));
const pClass = p => p == null ? '' : (p < 0.05 ? 'p-sig' : 'p-insig');
const badge = (v, cls='') => `<span class="stat-badge ${cls}">${v}</span>`;
const sigBadge = p => badge(p < 0.05 ? 'Significant (p<0.05)' : 'Not Significant', p < 0.05 ? 'success' : 'danger');

function setRunning(btn, running) {
  if (running) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Running…`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn._origLabel;
  }
}

async function postJSON(url, body) {
  const resp = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || resp.statusText);
  return data;
}

async function uploadFile(url, file) {
  const fd = new FormData(); fd.append('file', file);
  const resp = await fetch(url, {method:'POST', body: fd});
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || resp.statusText);
  return data;
}

function showError(container, msg) {
  container.innerHTML = `<div class="alert alert-danger py-2 px-3" role="alert"><i class="bi bi-exclamation-triangle me-1"></i>${msg}</div>`;
}

// ── Data Preview Modal ──────────────────────────────────────────────
let _pvData = null, _pvCols = [], _pvFiltered = [], _pvOnApply = null;
const PV_MAX_ROWS = 500;

function openDataPreview(rawData, filename, onApply) {
  _pvData = rawData; _pvOnApply = onApply;
  _pvCols = rawData.columns.map(c => ({ name: c.name, included: true, meta: c }));
  $('preview-title').textContent = filename;
  $('preview-subtitle').textContent = `${rawData.n_rows} rows × ${rawData.n_cols} columns`;
  $('preview-search').value = '';
  $('preview-row-from').value = '';
  $('preview-row-to').value = '';
  _renderPvColToggles();
  previewApplyFilter();
  $('preview-modal').style.display = 'block';
}

function closePreview() { $('preview-modal').style.display = 'none'; }

function _renderPvColToggles() {
  const wrap = $('preview-col-toggles');
  wrap.innerHTML = '';
  _pvCols.forEach((col, i) => {
    const span = document.createElement('span');
    span.className = 'col-toggle' + (col.included ? '' : ' excluded');
    span.textContent = col.name;
    span.addEventListener('click', () => {
      _pvCols[i].included = !_pvCols[i].included;
      span.classList.toggle('excluded');
      _renderPvTable();
    });
    wrap.appendChild(span);
  });
}

function previewToggleAllCols(on) {
  _pvCols.forEach(c => c.included = on);
  _renderPvColToggles();
  _renderPvTable();
}

function previewApplyFilter() {
  if (!_pvData) return;
  const search = ($('preview-search').value || '').toLowerCase();
  const fromR = parseInt($('preview-row-from').value) || 1;
  const toR   = parseInt($('preview-row-to').value)   || _pvData.data.length;
  _pvFiltered = [];
  _pvData.data.forEach((row, i) => {
    const n = i + 1;
    if (n < fromR || n > toR) return;
    if (search && !Object.values(row).join(' ').toLowerCase().includes(search)) return;
    _pvFiltered.push(i);
  });
  _renderPvTable();
}

function previewClearFilter() {
  $('preview-search').value = '';
  $('preview-row-from').value = '';
  $('preview-row-to').value = '';
  previewApplyFilter();
}

function _renderPvTable() {
  const selCols = _pvCols.filter(c => c.included);
  const display = _pvFiltered.slice(0, PV_MAX_ROWS);
  let html = '<thead><tr><th style="min-width:36px;color:#9ca3af">#</th>';
  selCols.forEach(c => { html += `<th>${c.name}</th>`; });
  html += '</tr></thead><tbody>';
  display.forEach(ri => {
    const row = _pvData.data[ri];
    html += `<tr><td style="color:#9ca3af;font-size:.75rem">${ri + 1}</td>`;
    selCols.forEach(c => { html += `<td>${row[c.name] ?? ''}</td>`; });
    html += '</tr>';
  });
  html += '</tbody>';
  $('preview-table').innerHTML = html;
  const total = _pvFiltered.length;
  const shown = Math.min(total, PV_MAX_ROWS);
  $('preview-status').textContent = `${shown}${shown < total ? ' of ' + total : ''} rows · ${selCols.length}/${_pvCols.length} columns selected`;
}

function previewApplySelection() {
  const selCols = _pvCols.filter(c => c.included);
  const selNames = selCols.map(c => c.name);
  const rows = _pvFiltered.map(i => {
    const src = _pvData.data[i], out = {};
    selNames.forEach(n => out[n] = src[n]);
    return out;
  });
  const filtered = { n_rows: rows.length, n_cols: selCols.length, columns: selCols.map(c => c.meta), data: rows };
  closePreview();
  if (_pvOnApply) _pvOnApply(filtered);
}

function _addPreviewBtn(zone, rawData, filename, applyFn) {
  let btn = zone.parentElement.querySelector('.preview-data-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-link preview-data-btn p-0 mt-1 d-block';
    zone.after(btn);
  }
  btn.innerHTML = '<i class="bi bi-table me-1"></i>Preview & filter data';
  btn.onclick = e => { e.preventDefault(); openDataPreview(rawData, filename, applyFn); };
}

function parseCSV(str) {
  return str.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(',').map(v => v.trim()));
}

function parseNums(str) {
  return str.split(/[\s,]+/).map(Number).filter(v => !isNaN(v));
}

// ── Sidebar navigation ──────────────────────────────────────────────
document.querySelectorAll('#sidebar .nav-link[data-section]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const sec = link.dataset.section;
    document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`section-${sec}`).classList.add('active');
  });
});

// ── Generic tab helper ──────────────────────────────────────────────
function initTabs(tabContainerId, paneAttr) {
  const container = document.getElementById(tabContainerId);
  if (!container) return;
  container.querySelectorAll('.nav-link').forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      const paneId = tab.dataset[paneAttr];
      container.querySelectorAll('.nav-link').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // panes are siblings of container's parent
      const parent = container.closest('.card-body') || container.parentElement;
      parent.querySelectorAll('.data-pane').forEach(p => p.classList.remove('active'));
      const target = document.getElementById(paneId);
      if (target) target.classList.add('active');
    });
  });
}

document.querySelectorAll('[data-source-tabs], .data-source-tabs').forEach(nav => {
  nav.querySelectorAll('.nav-link').forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      const paneId = tab.dataset.pane;
      if (!paneId) return;
      nav.querySelectorAll('.nav-link').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const parent = nav.closest('.card-body') || nav.parentElement;
      parent.querySelectorAll('.data-pane').forEach(p => p.classList.remove('active'));
      const pane = document.getElementById(paneId);
      if (pane) pane.classList.add('active');
    });
  });
});

// ── Clinical sub-tabs ───────────────────────────────────────────────
document.querySelectorAll('#clinical-sub-tabs .nav-link[data-clinical]').forEach(tab => {
  tab.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('#clinical-sub-tabs .nav-link').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.clinical-pane').forEach(p => p.style.display = 'none');
    tab.classList.add('active');
    document.getElementById(`clinical-${tab.dataset.clinical}`).style.display = 'block';
  });
});

// ── Epi sub-tabs ────────────────────────────────────────────────────
document.querySelectorAll('#epi-sub-tabs .nav-link[data-epi]').forEach(tab => {
  tab.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('#epi-sub-tabs .nav-link').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.epi-pane').forEach(p => p.style.display = 'none');
    tab.classList.add('active');
    document.getElementById(`epi-${tab.dataset.epi}`).style.display = 'block';
  });
});

// ── Upload zone helper ──────────────────────────────────────────────
function initUploadZone(zoneId, inputId, onFile) {
  const zone = $(zoneId), input = $(inputId);
  if (!zone || !input) return;
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  });
}

function populateSelect(sel, cols, filter) {
  sel.innerHTML = '';
  cols.filter(c => filter ? filter(c) : true).forEach(c => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

// ══════════════════════════════════════════════════════════════════════
// SURVIVAL ANALYSIS
// ══════════════════════════════════════════════════════════════════════
let survData = null;

function _applySurvData(data) {
  survData = data;
  const cols = data.columns;
  populateSelect($('surv-col-time'), cols, c => c.col_type === 'numeric');
  populateSelect($('surv-col-event'), cols, c => c.col_type === 'numeric');
  $('surv-col-group').innerHTML = '<option value="">— none —</option>';
  cols.forEach(c => $('surv-col-group').appendChild(new Option(c.name, c.name)));
  $('surv-col-map').style.display = 'block';
}

initUploadZone('surv-upload-zone', 'surv-file', async file => {
  try {
    const raw = await uploadFile('/api/data/upload', file);
    _applySurvData(raw);
    const zone = $('surv-upload-zone');
    zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${raw.n_rows} rows)`;
    _addPreviewBtn(zone, raw, file.name, d => {
      _applySurvData(d);
      zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${d.n_rows} rows selected)`;
    });
  } catch(err) { alert('Upload failed: ' + err.message); }
});

// REDCap fetch for survival
let survRcData = null;
$('surv-rc-fetch').addEventListener('click', async () => {
  const btn = $('surv-rc-fetch');
  const url = $('surv-rc-url').value.trim();
  const token = $('surv-rc-token').value.trim();
  if (!url || !token) return alert('Enter REDCap URL and token.');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Fetching…';
  $('surv-rc-status').textContent = '';
  try {
    const raw = await postJSON('/api/data/redcap', { url, token, raw_or_label: $('surv-rc-format').value });
    survRcData = raw;
    const cols = raw.columns;
    populateSelect($('surv-rc-col-time'), cols, c => c.col_type === 'numeric');
    populateSelect($('surv-rc-col-event'), cols, c => c.col_type === 'numeric');
    $('surv-rc-col-group').innerHTML = '<option value="">— none —</option>';
    cols.forEach(c => $('surv-rc-col-group').appendChild(new Option(c.name, c.name)));
    $('surv-rc-col-map').style.display = 'block';
    $('surv-rc-status').innerHTML = `<span class="text-success"><i class="bi bi-check-circle me-1"></i>${raw.n_rows} records · ${raw.n_cols} fields fetched</span>`;
    _addPreviewBtn($('surv-rc-fetch').parentElement.querySelector('#surv-rc-col-map') || $('surv-rc-fetch'), raw, 'REDCap data', d => {
      survRcData = d;
      $('surv-rc-status').innerHTML = `<span class="text-success"><i class="bi bi-check-circle me-1"></i>${d.n_rows} records selected</span>`;
    });
  } catch(err) {
    $('surv-rc-status').innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>${err.message}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cloud-download me-1"></i>Fetch from REDCap';
  }
});

// Manual table
function addSurvRow() {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="number" step="any"></td><td><input type="number" min="0" max="1" step="1" value="1"></td><td><input type="text"></td>`;
  $('surv-manual-body').appendChild(tr);
}
for (let i = 0; i < 6; i++) addSurvRow();
$('surv-add-row').addEventListener('click', addSurvRow);

$('surv-run')._origLabel = $('surv-run').innerHTML;
$('surv-run').addEventListener('click', async () => {
  const btn = $('surv-run');
  setRunning(btn, true);
  try {
    let time, event, groups = null;
    const activePane = document.querySelector('#surv-csv.data-pane.active, #surv-manual.data-pane.active, #surv-redcap.data-pane.active');
    const paneId = activePane ? activePane.id : 'surv-manual';

    if (paneId === 'surv-redcap' && survRcData) {
      const tCol = $('surv-rc-col-time').value, eCol = $('surv-rc-col-event').value, gCol = $('surv-rc-col-group').value;
      time = survRcData.data.map(r => parseFloat(r[tCol])).filter(v => !isNaN(v));
      event = survRcData.data.map(r => parseInt(r[eCol])).filter(v => !isNaN(v));
      if (gCol) groups = survRcData.data.map(r => r[gCol]);
    } else if (paneId === 'surv-csv' && survData) {
      const tCol = $('surv-col-time').value, eCol = $('surv-col-event').value, gCol = $('surv-col-group').value;
      time = survData.data.map(r => parseFloat(r[tCol])).filter(v => !isNaN(v));
      event = survData.data.map(r => parseInt(r[eCol])).filter(v => !isNaN(v));
      if (gCol) groups = survData.data.map(r => r[gCol]);
    } else {
      const rows = $('surv-manual-body').querySelectorAll('tr');
      time = []; event = []; const grpVals = [];
      rows.forEach(tr => {
        const inputs = tr.querySelectorAll('input');
        const t = parseFloat(inputs[0].value), e = parseInt(inputs[1].value);
        if (!isNaN(t) && !isNaN(e)) { time.push(t); event.push(e); grpVals.push(inputs[2].value.trim() || null); }
      });
      if (grpVals.some(g => g)) groups = grpVals;
    }
    if (!time.length) throw new Error('No valid data rows found.');

    const result = await postJSON('/api/survival/analyze', {time, event, groups});
    renderSurvival(result);
  } catch(err) {
    $('surv-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('surv-placeholder').style.display = 'block';
    $('surv-results').classList.remove('show');
  } finally {
    setRunning(btn, false);
  }
});

function renderSurvival(r) {
  $('surv-placeholder').style.display = 'none';
  $('surv-results').classList.add('show');

  // KM plot
  const traces = r.curves.map((c, i) => {
    const xs = [], ys = [], lo = [], hi = [];
    for (let j = 0; j < c.times.length; j++) {
      if (j > 0) { xs.push(c.times[j]); ys.push(c.survival[j-1]); lo.push(c.lower_ci[j-1]); hi.push(c.upper_ci[j-1]); }
      xs.push(c.times[j]); ys.push(c.survival[j]); lo.push(c.lower_ci[j]); hi.push(c.upper_ci[j]);
    }
    return [
      {x:xs, y:ys, mode:'lines', name:c.label, line:{color:COLORS[i], width:2.5}, type:'scatter'},
      {x:[...xs,...xs.slice().reverse()], y:[...hi,...lo.slice().reverse()], fill:'toself',
       fillcolor:COLORS[i]+'22', line:{width:0}, showlegend:false, hoverinfo:'skip', type:'scatter'},
    ];
  }).flat();

  Plotly.newPlot('surv-plot', traces, {
    ...LAYOUT_BASE, xaxis:{title:'Time', zeroline:false}, yaxis:{title:'Survival Probability', range:[0,1.05]},
  }, PLOTLY_CFG);

  // Stats
  let html = '<div class="row g-3">';
  r.curves.forEach(c => {
    html += `<div class="col-md-6"><div class="card border-0 bg-light p-3">
      <div class="fw-semibold mb-1">${c.label}</div>
      <div class="d-flex flex-wrap gap-2">
        ${badge('n = '+c.n)} ${badge('Events: '+c.n_total_events)} ${badge('Median: '+(c.median_survival != null ? fmt(c.median_survival,1) : 'NR'))}
      </div></div></div>`;
  });
  html += '</div>';
  if (r.logrank) {
    const lr = r.logrank;
    html += `<hr><div class="mt-3"><strong>Log-rank Test</strong> &nbsp;
      ${badge('χ² = '+fmt(lr.chi2,3))} &nbsp;
      <span class="${pClass(lr.p_value)}">p = ${pFmt(lr.p_value)}</span> &nbsp;
      ${sigBadge(lr.p_value)}</div>`;
  }
  $('surv-stats').innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════
// META-ANALYSIS
// ══════════════════════════════════════════════════════════════════════
let metaData = null;
let metaStudyCount = 0;

function addMetaStudy() {
  metaStudyCount++;
  const div = document.createElement('div');
  div.className = 'study-row';
  div.innerHTML = `<div class="row g-1 align-items-center">
    <div class="col-12"><input type="text" class="form-control form-control-sm" placeholder="Study name" data-field="name" value="Study ${metaStudyCount}"></div>
    <div class="col-3"><small class="text-muted">Events 1</small><input type="number" class="form-control form-control-sm" data-field="events_1" value="${Math.floor(20+Math.random()*30)}" min="0"></div>
    <div class="col-3"><small class="text-muted">N 1</small><input type="number" class="form-control form-control-sm" data-field="n_1" value="100" min="1"></div>
    <div class="col-3"><small class="text-muted">Events 2</small><input type="number" class="form-control form-control-sm" data-field="events_2" value="${Math.floor(15+Math.random()*25)}" min="0"></div>
    <div class="col-3"><small class="text-muted">N 2</small><input type="number" class="form-control form-control-sm" data-field="n_2" value="100" min="1"></div>
    <div class="col-12 text-end"><button class="btn btn-sm btn-link text-danger p-0" onclick="this.closest('.study-row').remove()">Remove</button></div>
  </div>`;
  $('meta-studies').appendChild(div);
}
for (let i = 0; i < 4; i++) addMetaStudy();
$('meta-add-study').addEventListener('click', addMetaStudy);

function _applyMetaData(data) {
  metaData = data;
  const cols = data.columns;
  ['meta-col-name','meta-col-e1','meta-col-n1','meta-col-e2','meta-col-n2'].forEach(id => {
    const sel = $(id); sel.innerHTML = '';
    cols.forEach(c => sel.appendChild(new Option(c.name, c.name)));
  });
  $('meta-col-map').style.display = 'block';
}

initUploadZone('meta-upload-zone', 'meta-file', async file => {
  try {
    const raw = await uploadFile('/api/data/upload', file);
    _applyMetaData(raw);
    const zone = $('meta-upload-zone');
    zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${raw.n_rows} rows)`;
    _addPreviewBtn(zone, raw, file.name, d => {
      _applyMetaData(d);
      zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${d.n_rows} rows selected)`;
    });
  } catch(e) { alert(e.message); }
});

$('meta-run')._origLabel = $('meta-run').innerHTML;
$('meta-run').addEventListener('click', async () => {
  const btn = $('meta-run');
  setRunning(btn, true);
  try {
    let studies = [];
    const activePane = document.querySelector('#meta-csv.data-pane.active, #meta-manual.data-pane.active');
    const paneId = activePane ? activePane.id : 'meta-manual';

    if (paneId === 'meta-csv' && metaData) {
      const namC=$('meta-col-name').value, e1C=$('meta-col-e1').value, n1C=$('meta-col-n1').value, e2C=$('meta-col-e2').value, n2C=$('meta-col-n2').value;
      studies = metaData.data.map(r => ({name:r[namC], events_1:parseInt(r[e1C]), n_1:parseInt(r[n1C]), events_2:parseInt(r[e2C]), n_2:parseInt(r[n2C])}));
    } else {
      $('meta-studies').querySelectorAll('.study-row').forEach(row => {
        const f = field => row.querySelector(`[data-field="${field}"]`)?.value;
        studies.push({name:f('name'), events_1:parseInt(f('events_1')), n_1:parseInt(f('n_1')), events_2:parseInt(f('events_2')), n_2:parseInt(f('n_2'))});
      });
    }
    const result = await postJSON('/api/meta/analyze', {studies, measure:$('meta-measure').value, model:$('meta-model').value});
    renderMeta(result);
  } catch(err) {
    $('meta-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('meta-placeholder').style.display = 'block';
    $('meta-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderMeta(r) {
  $('meta-placeholder').style.display = 'none';
  $('meta-results').classList.add('show');

  const onLog = r.measure === 'OR' || r.measure === 'RR';
  const nullDisp = r.null_display;
  const label = onLog ? r.measure : r.label;

  // Forest plot
  const studies = r.forest_studies;
  const yLabels = [...studies.map(s => s.name), '', 'Pooled'];
  const yIdx = studies.map((_, i) => i);
  const pooledY = studies.length + 1;

  const studyTrace = {
    type:'scatter', mode:'markers', x: studies.map(s => s.effect_display),
    y: yIdx, error_x:{type:'data', symmetric:false,
      array:studies.map(s => s.ci_hi_display - s.effect_display),
      arrayminus:studies.map(s => s.effect_display - s.ci_lo_display), thickness:2},
    marker:{symbol:'square', size:studies.map(s => Math.max(6, s.weight/3)), color:'#1d4ed8'},
    hovertemplate:'%{customdata[0]}<br>'+label+': %{x:.3f} (%{customdata[1]:.3f}–%{customdata[2]:.3f})<extra></extra>',
    customdata: studies.map(s => [s.name, s.ci_lo_display, s.ci_hi_display]),
    showlegend:false,
  };

  const pooled = r.pooled;
  const pooledTrace = {
    type:'scatter', mode:'markers', x:[pooled.display], y:[pooledY],
    error_x:{type:'data', symmetric:false, array:[pooled.ci_display[1]-pooled.display], arrayminus:[pooled.display-pooled.ci_display[0]], thickness:2.5, color:'#dc2626'},
    marker:{symbol:'diamond', size:14, color:'#dc2626'},
    name:'Pooled', hovertemplate:`Pooled ${label}: %{x:.3f}<extra></extra>`,
  };

  const nullLine = {type:'scatter', mode:'lines', x:[nullDisp, nullDisp], y:[-1, pooledY+1],
    line:{color:'#9ca3af', dash:'dash', width:1}, showlegend:false, hoverinfo:'skip'};

  Plotly.newPlot('meta-forest-plot', [studyTrace, pooledTrace, nullLine], {
    ...LAYOUT_BASE,
    xaxis:{title:label, zeroline:false},
    yaxis:{tickvals:[...yIdx, pooledY], ticktext:yLabels, zeroline:false, autorange:'reversed'},
    height:Math.max(350, studies.length*35+100),
    shapes:[{type:'line', x0:nullDisp, x1:nullDisp, y0:-0.5, y1:pooledY+0.5, line:{color:'#9ca3af',dash:'dash',width:1}}],
  }, PLOTLY_CFG);

  // Funnel plot
  const fd = r.funnel_data;
  const yMax = Math.max(...fd.sei) * 1.1;
  Plotly.newPlot('meta-funnel-plot', [
    {x:fd.yi.map(y => onLog ? Math.exp(y) : y), y:fd.sei, mode:'markers', text:fd.names, type:'scatter',
     marker:{color:'#1d4ed8', opacity:.7, size:9}, hovertemplate:'%{text}<br>'+label+': %{x:.3f}<br>SE: %{y:.4f}<extra></extra>'},
    {x:[nullDisp, nullDisp], y:[yMax, 0], mode:'lines', line:{color:'#9ca3af',dash:'dash'}, showlegend:false, hoverinfo:'skip'},
  ], {
    ...LAYOUT_BASE, xaxis:{title:label}, yaxis:{title:'Standard Error', autorange:'reversed'},
    title:{text:'Funnel Plot', font:{size:13}},
  }, PLOTLY_CFG);

  // Stats
  const het = r.heterogeneity;
  const fe = r.fixed_effects, re = r.random_effects;
  $('meta-stats').innerHTML = `
    <div class="row g-3 mb-3">
      <div class="col-md-6">
        <table class="table table-sm table-bordered">
          <thead class="table-light"><tr><th>Model</th><th>${label}</th><th>95% CI</th><th>p</th></tr></thead>
          <tbody>
            <tr><td>Fixed effects</td><td>${fmt(fe.display,3)}</td><td>${fmt(fe.ci_display[0],3)}–${fmt(fe.ci_display[1],3)}</td><td class="${pClass(fe.p)}">${pFmt(fe.p)}</td></tr>
            <tr class="table-primary fw-semibold"><td>Random effects</td><td>${fmt(re.display,3)}</td><td>${fmt(re.ci_display[0],3)}–${fmt(re.ci_display[1],3)}</td><td class="${pClass(re.p)}">${pFmt(re.p)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="col-md-6">
        <table class="table table-sm table-bordered">
          <thead class="table-light"><tr><th>Heterogeneity</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Q (df=${het.df})</td><td>${fmt(het.Q,2)} (p=${pFmt(het.Q_p)})</td></tr>
            <tr><td>I²</td><td>${fmt(het.I2,1)}% <small class="text-muted">${het.interpretation}</small></td></tr>
            <tr><td>τ²</td><td>${fmt(het.tau2,4)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div>${sigBadge(pooled.p)} &nbsp; Active model: <strong>${r.model === 'random' ? 'Random Effects (DerSimonian-Laird)' : 'Fixed Effects (Inverse Variance)'}</strong> &nbsp; n=${r.n_studies} studies</div>`;
}

// ══════════════════════════════════════════════════════════════════════
// CLINICAL — T-TEST
// ══════════════════════════════════════════════════════════════════════
let ttestData = null;

function _applyTtestData(data) {
  ttestData = data;
  populateSelect($('ttest-col-outcome'), data.columns.filter(c => c.col_type === 'numeric'));
  populateSelect($('ttest-col-group'), data.columns);
  $('ttest-col-map').style.display = 'block';
}

initUploadZone('ttest-upload-zone', 'ttest-file', async file => {
  try {
    const raw = await uploadFile('/api/data/upload', file);
    _applyTtestData(raw);
    const zone = $('ttest-upload-zone');
    zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${raw.n_rows} rows)`;
    _addPreviewBtn(zone, raw, file.name, d => {
      _applyTtestData(d);
      zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${d.n_rows} rows selected)`;
    });
  } catch(e) { alert(e.message); }
});

$('ttest-run')._origLabel = $('ttest-run').innerHTML;
$('ttest-run').addEventListener('click', async () => {
  const btn = $('ttest-run');
  setRunning(btn, true);
  try {
    let g1, g2;
    const activePane = document.querySelector('#ttest-csv.data-pane.active, #ttest-manual.data-pane.active');
    if (activePane?.id === 'ttest-csv' && ttestData) {
      const oCol = $('ttest-col-outcome').value, gCol = $('ttest-col-group').value;
      const groups = {};
      ttestData.data.forEach(r => {
        const g = r[gCol], v = parseFloat(r[oCol]);
        if (!isNaN(v)) { groups[g] = groups[g] || []; groups[g].push(v); }
      });
      const keys = Object.keys(groups);
      if (keys.length < 2) throw new Error('Need at least 2 groups.');
      g1 = groups[keys[0]]; g2 = groups[keys[1]];
    } else {
      g1 = parseNums($('ttest-g1').value);
      g2 = parseNums($('ttest-g2').value);
    }
    const result = await postJSON('/api/clinical/ttest', {group1:g1, group2:g2, paired:$('ttest-paired').checked, equal_var:$('ttest-equalvar').checked});
    renderTtest(result, g1, g2);
  } catch(err) {
    $('ttest-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('ttest-placeholder').style.display = 'block';
    $('ttest-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderTtest(r, g1, g2) {
  $('ttest-placeholder').style.display = 'none';
  $('ttest-results').classList.add('show');

  Plotly.newPlot('ttest-plot', [
    {y:g1, type:'violin', name:'Group 1', box:{visible:true}, meanline:{visible:true}, fillcolor:COLORS[0]+'44', line:{color:COLORS[0]}},
    {y:g2, type:'violin', name:'Group 2', box:{visible:true}, meanline:{visible:true}, fillcolor:COLORS[1]+'44', line:{color:COLORS[1]}},
  ], {...LAYOUT_BASE, yaxis:{title:'Value'}, violinmode:'group'}, PLOTLY_CFG);

  $('ttest-stats').innerHTML = `
    <div class="row g-2 mb-3">
      ${['Group 1','Group 2'].map((n,i) => `<div class="col-6"><div class="card border-0 bg-light p-2 text-center"><div class="fw-semibold">${n}</div>
        <div>n=${i===0?r.n1:r.n2} &nbsp; mean=${fmt(i===0?r.mean1:r.mean2,3)} &nbsp; SD=${fmt(i===0?r.sd1:r.sd2,3)}</div></div></div>`).join('')}
    </div>
    <table class="table table-sm table-bordered">
      <tbody>
        <tr><td>Mean difference</td><td>${fmt(r.mean_diff,4)} (95% CI: ${fmt(r.ci_95[0],4)} to ${fmt(r.ci_95[1],4)})</td></tr>
        <tr><td>${r.paired ? 'Paired' : "Welch's"} t-statistic</td><td>${fmt(r.t_stat,4)} (df=${fmt(r.df,1)})</td></tr>
        <tr><td>p-value</td><td class="${pClass(r.p_value)}"><strong>${pFmt(r.p_value)}</strong></td></tr>
        <tr><td>Cohen's d</td><td>${fmt(r.cohens_d,3)} <small class="text-muted">(${r.effect_size_label})</small></td></tr>
      </tbody>
    </table>
    <div>${sigBadge(r.p_value)}</div>`;
}

// ── ANOVA ───────────────────────────────────────────────────────────
let anovaData = null;
let anovaGroupCount = 0;

function addAnovaGroup() {
  anovaGroupCount++;
  const div = document.createElement('div');
  div.className = 'mb-2';
  div.innerHTML = `<div class="d-flex gap-1 align-items-center">
    <input type="text" class="form-control form-control-sm" style="width:100px" placeholder="Group ${anovaGroupCount}" data-anova-name>
    <input type="text" class="form-control form-control-sm" placeholder="Values (comma-separated)" data-anova-vals>
    <button class="btn btn-sm btn-outline-danger" onclick="this.closest('div.mb-2').remove()">×</button>
  </div>`;
  $('anova-groups-manual').appendChild(div);
}
for (let i = 0; i < 3; i++) addAnovaGroup();
$('anova-add-group').addEventListener('click', addAnovaGroup);

function _applyAnovaData(data) {
  anovaData = data;
  populateSelect($('anova-col-outcome'), data.columns.filter(c => c.col_type === 'numeric'));
  populateSelect($('anova-col-group'), data.columns);
  $('anova-col-map').style.display = 'block';
}

initUploadZone('anova-upload-zone', 'anova-file', async file => {
  try {
    const raw = await uploadFile('/api/data/upload', file);
    _applyAnovaData(raw);
    const zone = $('anova-upload-zone');
    zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${raw.n_rows} rows)`;
    _addPreviewBtn(zone, raw, file.name, d => {
      _applyAnovaData(d);
      zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${d.n_rows} rows selected)`;
    });
  } catch(e) { alert(e.message); }
});

$('anova-run')._origLabel = $('anova-run').innerHTML;
$('anova-run').addEventListener('click', async () => {
  const btn = $('anova-run');
  setRunning(btn, true);
  try {
    let groups = [], groupNames = [];
    const activePane = document.querySelector('#anova-csv.data-pane.active, #anova-manual.data-pane.active');
    if (activePane?.id === 'anova-csv' && anovaData) {
      const oCol = $('anova-col-outcome').value, gCol = $('anova-col-group').value;
      const map = {};
      anovaData.data.forEach(r => { const g = r[gCol], v = parseFloat(r[oCol]); if (!isNaN(v)) { map[g] = map[g]||[]; map[g].push(v); } });
      groupNames = Object.keys(map); groups = groupNames.map(k => map[k]);
    } else {
      document.querySelectorAll('#anova-groups-manual .mb-2').forEach(div => {
        const name = div.querySelector('[data-anova-name]').value.trim();
        const vals = parseNums(div.querySelector('[data-anova-vals]').value);
        if (vals.length > 0) { groups.push(vals); groupNames.push(name || `Group ${groups.length}`); }
      });
    }
    const result = await postJSON('/api/clinical/anova', {groups, group_names:groupNames});
    renderAnova(result, groups, groupNames);
  } catch(err) {
    $('anova-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('anova-placeholder').style.display = 'block';
    $('anova-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderAnova(r, groups, groupNames) {
  $('anova-placeholder').style.display = 'none';
  $('anova-results').classList.add('show');

  Plotly.newPlot('anova-plot',
    groups.map((g, i) => ({y:g, type:'box', name:groupNames[i], marker:{color:COLORS[i]}, boxpoints:'all', jitter:.4, pointpos:0})),
    {...LAYOUT_BASE, yaxis:{title:'Value'}, boxmode:'group'}, PLOTLY_CFG);

  const at = r.anova_table;
  let html = `<table class="table table-sm table-bordered mb-3">
    <thead class="table-light"><tr><th>Source</th><th>SS</th><th>df</th><th>MS</th><th>F</th><th>p</th></tr></thead>
    <tbody>
      <tr><td>Between</td><td>${fmt(at.ss_between,3)}</td><td>${at.df_between}</td><td>${fmt(at.ms_between,3)}</td><td>${fmt(at.f_stat,4)}</td><td class="${pClass(at.p_value)}">${pFmt(at.p_value)}</td></tr>
      <tr><td>Within</td><td>${fmt(at.ss_within,3)}</td><td>${at.df_within}</td><td>${fmt(at.ms_within,3)}</td><td></td><td></td></tr>
    </tbody></table>`;
  html += `<div class="mb-2">${sigBadge(at.p_value)} &nbsp; η² = ${fmt(r.eta_squared,3)}</div>`;

  if (r.posthoc_tukey.length) {
    html += `<p class="fw-semibold mb-1">Tukey HSD Post-hoc</p>
      <table class="table table-sm table-bordered">
      <thead class="table-light"><tr><th>Comparison</th><th>Diff</th><th>p (adjusted)</th></tr></thead><tbody>`;
    r.posthoc_tukey.forEach(ph => {
      html += `<tr><td>${ph.group1} vs ${ph.group2}</td><td>${fmt(ph.mean_diff,3)}</td><td class="${pClass(ph.p_adjusted)}">${pFmt(ph.p_adjusted)}</td></tr>`;
    });
    html += '</tbody></table>';
  }
  $('anova-stats').innerHTML = html;
}

// ── Chi-Square ──────────────────────────────────────────────────────
function buildChisqTable() {
  const rows = parseInt($('chisq-rows').value), cols = parseInt($('chisq-cols').value);
  let html = '<table class="table table-sm table-bordered text-center"><thead><tr><th></th>';
  for (let c = 0; c < cols; c++) html += `<th><input type="text" class="form-control form-control-sm p-1" id="chisq-ch${c}" value="Col ${c+1}" style="width:70px"></th>`;
  html += '</tr></thead><tbody>';
  for (let r = 0; r < rows; r++) {
    html += `<tr><td><input type="text" class="form-control form-control-sm p-1" id="chisq-rh${r}" value="Row ${r+1}" style="width:70px"></td>`;
    for (let c = 0; c < cols; c++) html += `<td><input type="number" class="form-control form-control-sm p-1" id="chisq-${r}-${c}" value="0" min="0" style="width:60px"></td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  $('chisq-table-container').innerHTML = html;
}
buildChisqTable();
$('chisq-build-table').addEventListener('click', buildChisqTable);

$('chisq-run')._origLabel = $('chisq-run').innerHTML;
$('chisq-run').addEventListener('click', async () => {
  const btn = $('chisq-run');
  setRunning(btn, true);
  try {
    const rows = parseInt($('chisq-rows').value), cols = parseInt($('chisq-cols').value);
    const observed = [], rowNames = [], colNames = [];
    for (let c = 0; c < cols; c++) colNames.push($(`chisq-ch${c}`)?.value || `Col ${c+1}`);
    for (let r = 0; r < rows; r++) {
      rowNames.push($(`chisq-rh${r}`)?.value || `Row ${r+1}`);
      const row = [];
      for (let c = 0; c < cols; c++) row.push(parseInt($(`chisq-${r}-${c}`)?.value || 0));
      observed.push(row);
    }
    const result = await postJSON('/api/clinical/chi_square', {observed, row_names:rowNames, col_names:colNames});
    renderChiSq(result);
  } catch(err) {
    $('chisq-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('chisq-placeholder').style.display = 'block';
    $('chisq-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderChiSq(r) {
  $('chisq-placeholder').style.display = 'none';
  $('chisq-results').classList.add('show');

  Plotly.newPlot('chisq-plot', [{z:r.observed, x:r.col_names, y:r.row_names, type:'heatmap',
    colorscale:'Blues', text:r.observed, texttemplate:'%{text}', showscale:false}],
    {...LAYOUT_BASE, margin:{t:30,r:20,b:60,l:100}}, PLOTLY_CFG);

  let html = `<table class="table table-sm table-bordered mb-3">
    <tbody>
      <tr><td>χ²</td><td>${fmt(r.chi2,4)} (df=${r.df})</td></tr>
      <tr><td>p-value</td><td class="${pClass(r.p_value)}"><strong>${pFmt(r.p_value)}</strong></td></tr>
      <tr><td>Cramér's V</td><td>${fmt(r.cramers_v,4)}</td></tr>
    </tbody></table>`;
  if (r.fisher_exact) html += `<p><strong>Fisher's Exact Test:</strong> OR = ${fmt(r.fisher_exact.odds_ratio,3)}, p = <span class="${pClass(r.fisher_exact.p_value)}">${pFmt(r.fisher_exact.p_value)}</span></p>`;
  html += sigBadge(r.p_value);
  $('chisq-stats').innerHTML = html;
}

// ── Sample Size ─────────────────────────────────────────────────────
$('power-test').addEventListener('change', () => {
  const isTtest = $('power-test').value === 'ttest_2samp';
  $('power-ttest-params').style.display = isTtest ? 'block' : 'none';
  $('power-prop-params').style.display = isTtest ? 'none' : 'block';
});

$('power-run')._origLabel = $('power-run').innerHTML;
$('power-run').addEventListener('click', async () => {
  const btn = $('power-run');
  setRunning(btn, true);
  try {
    const test = $('power-test').value;
    const body = {
      test, alpha:parseFloat($('power-alpha').value), power:parseFloat($('power-power').value),
      ratio:parseFloat($('power-ratio').value),
    };
    if (test === 'ttest_2samp') body.effect_size = parseFloat($('power-d').value);
    else { body.p1 = parseFloat($('power-p1').value); body.p2 = parseFloat($('power-p2').value); }
    const result = await postJSON('/api/clinical/sample_size', body);
    renderPower(result, body);
  } catch(err) {
    $('power-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('power-placeholder').style.display = 'block';
    $('power-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderPower(r, params) {
  $('power-placeholder').style.display = 'none';
  $('power-results').classList.add('show');

  // Power curve: vary n, show power
  const ns = Array.from({length:60}, (_, i) => Math.round(10 + i * Math.max(1, r.n1/20)));
  const powers = ns.map(n => {
    const z_a = 1.96, es = r.effect_size || 0.5;
    const pw = 1 - (1 / (1 + Math.exp(-(-z_a + es * Math.sqrt(n/2)))));
    return Math.min(0.999, Math.max(0, 1 - (1 - pw)));
  });
  // Correct power calculation approximation
  const correctPowers = ns.map(n => {
    const z_alpha = 1.96;
    if (r.test === 'ttest_2samp') {
      const es = r.effect_size || 0.5;
      const nc = es * Math.sqrt(n / 2);
      // Normal approximation
      return Math.min(0.999, 1 - (0.5 * (1 + Math.erf((z_alpha - nc) / Math.sqrt(2)))));
    }
    return null;
  }).filter(v => v !== null);

  Plotly.newPlot('power-plot', [
    {x:ns, y:correctPowers.length ? correctPowers : powers, type:'scatter', mode:'lines', name:'Power',
     line:{color:COLORS[0], width:2.5}},
    {x:[r.n1, r.n1], y:[0, 1], mode:'lines', line:{color:COLORS[2], dash:'dash'}, name:`n₁=${r.n1}`},
    {x:[Math.min(...ns), Math.max(...ns)], y:[params.power, params.power], mode:'lines', line:{color:COLORS[3], dash:'dot'}, name:`Target power=${params.power}`},
  ], {
    ...LAYOUT_BASE,
    xaxis:{title:'Sample size (n₁)'},
    yaxis:{title:'Statistical power', range:[0,1]},
  }, PLOTLY_CFG);

  $('power-stats').innerHTML = `
    <div class="row g-3">
      <div class="col text-center"><div class="stat-badge" style="font-size:1.3rem;padding:.5rem 1.2rem">${r.n1}</div><div class="mt-1 text-muted" style="font-size:.85rem">n per group (group 1)</div></div>
      <div class="col text-center"><div class="stat-badge" style="font-size:1.3rem;padding:.5rem 1.2rem">${r.n2}</div><div class="mt-1 text-muted" style="font-size:.85rem">n per group (group 2)</div></div>
      <div class="col text-center"><div class="stat-badge success" style="font-size:1.3rem;padding:.5rem 1.2rem">${r.n_total}</div><div class="mt-1 text-muted" style="font-size:.85rem">Total n</div></div>
    </div>
    <table class="table table-sm table-bordered mt-3">
      <tbody>
        <tr><td>Test</td><td>${r.test === 'ttest_2samp' ? 'Two-sample t-test' : 'Two proportions z-test'}</td></tr>
        <tr><td>α</td><td>${r.alpha} (two-tailed)</td></tr>
        <tr><td>Power (1−β)</td><td>${r.power}</td></tr>
        <tr><td>Effect size</td><td>${fmt(r.effect_size,3)}</td></tr>
        <tr><td>Allocation ratio (n₂/n₁)</td><td>${r.ratio}</td></tr>
      </tbody>
    </table>`;
}

// ══════════════════════════════════════════════════════════════════════
// EPIDEMIOLOGY — 2x2 TABLE
// ══════════════════════════════════════════════════════════════════════
$('epi-twobytwo-run')._origLabel = $('epi-twobytwo-run').innerHTML;
$('epi-twobytwo-run').addEventListener('click', async () => {
  const btn = $('epi-twobytwo-run');
  setRunning(btn, true);
  try {
    const result = await postJSON('/api/epi/two_by_two', {
      a:parseInt($('epi-a').value), b:parseInt($('epi-b').value),
      c:parseInt($('epi-c').value), d:parseInt($('epi-d').value),
      exposure_name:$('epi-exp-name').value, outcome_name:$('epi-out-name').value,
    });
    renderTwoByTwo(result);
  } catch(err) {
    $('twobytwo-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('twobytwo-placeholder').style.display = 'block';
    $('twobytwo-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderTwoByTwo(r) {
  $('twobytwo-placeholder').style.display = 'none';
  $('twobytwo-results').classList.add('show');

  const measures = [], vals = [], lo = [], hi = [];
  if (r.odds_ratio.value != null) {
    measures.push('Odds Ratio'); vals.push(r.odds_ratio.value);
    lo.push(r.odds_ratio.ci_95[0]); hi.push(r.odds_ratio.ci_95[1]);
  }
  if (r.relative_risk.value != null) {
    measures.push('Relative Risk'); vals.push(r.relative_risk.value);
    lo.push(r.relative_risk.ci_95[0]); hi.push(r.relative_risk.ci_95[1]);
  }

  Plotly.newPlot('twobytwo-plot', [
    {x:vals, y:measures, error_x:{type:'data', symmetric:false, array:hi.map((h,i) => h-vals[i]), arrayminus:vals.map((v,i) => v-lo[i])},
     mode:'markers', type:'scatter', marker:{size:12, color:COLORS[0]}},
    {x:[1,1], y:[-1, measures.length], mode:'lines', line:{dash:'dash', color:'#9ca3af'}, showlegend:false},
  ], {
    ...LAYOUT_BASE, xaxis:{title:'Effect estimate (95% CI)', type:'log'},
    yaxis:{zeroline:false}, height:250,
  }, PLOTLY_CFG);

  const risks = r.risks;
  $('twobytwo-stats').innerHTML = `
    <div class="row g-2 mb-3">
      <div class="col-md-4"><table class="table table-sm table-bordered"><thead class="table-light"><tr><th></th><th>Out+</th><th>Out−</th></tr></thead>
        <tbody><tr><th>Exp+</th><td>${r.table.a}</td><td>${r.table.b}</td></tr><tr><th>Exp−</th><td>${r.table.c}</td><td>${r.table.d}</td></tr></tbody></table></div>
      <div class="col-md-8"><table class="table table-sm table-bordered">
        <tbody>
          <tr><td>Risk (exposed)</td><td>${fmt(risks.risk_exposed,4)} (${(risks.risk_exposed*100).toFixed(1)}%)</td></tr>
          <tr><td>Risk (unexposed)</td><td>${fmt(risks.risk_unexposed,4)} (${(risks.risk_unexposed*100).toFixed(1)}%)</td></tr>
          <tr><td>Risk Difference</td><td>${fmt(risks.risk_difference,4)} (95% CI: ${fmt(risks.rd_ci_95[0],4)} to ${fmt(risks.rd_ci_95[1],4)})</td></tr>
          <tr><td>Relative Risk</td><td>${r.relative_risk.value!=null ? fmt(r.relative_risk.value,3)+' (95% CI: '+fmt(r.relative_risk.ci_95[0],3)+'–'+fmt(r.relative_risk.ci_95[1],3)+')' : 'N/A'}</td></tr>
          <tr><td>Odds Ratio</td><td>${r.odds_ratio.value!=null ? fmt(r.odds_ratio.value,3)+' (95% CI: '+fmt(r.odds_ratio.ci_95[0],3)+'–'+fmt(r.odds_ratio.ci_95[1],3)+')' : 'N/A'}</td></tr>
          <tr><td>χ² (Yates)</td><td class="${pClass(r.chi_square.p_value)}">${fmt(r.chi_square.value,4)}, p=${pFmt(r.chi_square.p_value)}</td></tr>
          <tr><td>Fisher's p</td><td class="${pClass(r.fisher_exact_p)}">${pFmt(r.fisher_exact_p)}</td></tr>
          <tr><td>${r.nnt.type}</td><td>${r.nnt.value!=null ? fmt(r.nnt.value,1) : 'N/A'}</td></tr>
        </tbody></table></div>
    </div>
    <div>${sigBadge(r.chi_square.p_value)}</div>`;
}

// ── Logistic Regression ─────────────────────────────────────────────
let logisticData = null;

function _applyLogisticData(data) {
  logisticData = data;
  const cols = data.columns;
  populateSelect($('logistic-col-outcome'), cols.filter(c => c.col_type === 'numeric'));
  const predDiv = $('logistic-predictors');
  predDiv.innerHTML = '';
  cols.forEach(c => {
    predDiv.innerHTML += `<div class="form-check"><input class="form-check-input" type="checkbox" id="lp-${c.name}" data-col="${c.name}" data-type="${c.col_type}">
      <label class="form-check-label" style="font-size:.82rem" for="lp-${c.name}">${c.name} <span class="text-muted">(${c.col_type})</span></label></div>`;
  });
  $('logistic-col-map').style.display = 'block';
}

initUploadZone('logistic-upload-zone', 'logistic-file', async file => {
  try {
    const raw = await uploadFile('/api/data/upload', file);
    _applyLogisticData(raw);
    const zone = $('logistic-upload-zone');
    zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${raw.n_rows} rows)`;
    _addPreviewBtn(zone, raw, file.name, d => {
      _applyLogisticData(d);
      zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${d.n_rows} rows selected)`;
    });
  } catch(e) { alert(e.message); }
});

$('logistic-run')._origLabel = $('logistic-run').innerHTML;
$('logistic-run').addEventListener('click', async () => {
  if (!logisticData) return alert('Upload a file first.');
  const btn = $('logistic-run');
  setRunning(btn, true);
  try {
    const oCol = $('logistic-col-outcome').value;
    const selected = [...document.querySelectorAll('#logistic-predictors input:checked')];
    if (!selected.length) throw new Error('Select at least one predictor.');
    const outcome = logisticData.data.map(r => parseInt(r[oCol]));
    const predictors = {}, predictor_types = {};
    selected.forEach(cb => {
      const col = cb.dataset.col, typ = cb.dataset.type;
      predictors[col] = logisticData.data.map(r => typ === 'numeric' ? parseFloat(r[col]) : r[col]);
      predictor_types[col] = typ === 'numeric' ? 'continuous' : 'categorical';
    });
    const result = await postJSON('/api/epi/logistic', {outcome, predictors, predictor_types});
    renderLogistic(result);
  } catch(err) {
    $('logistic-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('logistic-placeholder').style.display = 'block';
    $('logistic-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderLogistic(r) {
  $('logistic-placeholder').style.display = 'none';
  $('logistic-results').classList.add('show');

  const coefs = r.coefficients.filter(c => c.odds_ratio != null);
  Plotly.newPlot('logistic-plot', [{
    x:coefs.map(c => c.odds_ratio), y:coefs.map(c => c.variable),
    error_x:{type:'data', symmetric:false, array:coefs.map(c => c.or_ci_95[1]-c.odds_ratio), arrayminus:coefs.map(c => c.odds_ratio-c.or_ci_95[0])},
    mode:'markers', type:'scatter', marker:{size:10, color:coefs.map(c => c.p_value<0.05 ? COLORS[0] : COLORS[2])},
  }, {x:[1,1], y:[-1, coefs.length], mode:'lines', line:{dash:'dash', color:'#9ca3af'}, showlegend:false}],
  {...LAYOUT_BASE, xaxis:{title:'Odds Ratio (95% CI)', type:'log'}, yaxis:{zeroline:false}}, PLOTLY_CFG);

  $('logistic-stats').innerHTML = `
    <div class="mb-2">${badge('n='+r.n)} ${badge('Events='+r.n_events)} ${badge('AIC='+fmt(r.aic,1))} ${badge('McFadden R²='+fmt(r.mcfadden_r2,3))}</div>
    <table class="table table-sm table-bordered">
      <thead class="table-light"><tr><th>Variable</th><th>OR</th><th>95% CI</th><th>p</th></tr></thead>
      <tbody>
        ${r.coefficients.filter(c=>c.odds_ratio!=null).map(c => `<tr${c.significant?' class="table-warning"':''}>
          <td>${c.variable}</td><td>${fmt(c.odds_ratio,3)}</td><td>${fmt(c.or_ci_95[0],3)}–${fmt(c.or_ci_95[1],3)}</td>
          <td class="${pClass(c.p_value)}">${pFmt(c.p_value)}</td></tr>`).join('')}
      </tbody></table>`;
}

// ── Incidence Rate ──────────────────────────────────────────────────
$('ir-compare').addEventListener('change', () => {
  $('ir-group2').style.display = $('ir-compare').checked ? 'block' : 'none';
});

$('ir-run')._origLabel = $('ir-run').innerHTML;
$('ir-run').addEventListener('click', async () => {
  const btn = $('ir-run');
  setRunning(btn, true);
  try {
    const body = {events:parseInt($('ir-events1').value), person_time:parseFloat($('ir-pt1').value), time_unit:$('ir-unit').value};
    if ($('ir-compare').checked) {
      body.comparison_events = parseInt($('ir-events2').value);
      body.comparison_person_time = parseFloat($('ir-pt2').value);
    }
    const result = await postJSON('/api/epi/incidence_rate', body);
    renderIncidence(result);
  } catch(err) {
    $('ir-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('ir-placeholder').style.display = 'block';
    $('ir-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderIncidence(r) {
  $('ir-placeholder').style.display = 'none';
  $('ir-results').classList.add('show');

  let html = `<table class="table table-sm table-bordered">
    <tbody>
      <tr><td>Events (group 1)</td><td>${r.events}</td></tr>
      <tr><td>Person-time (group 1)</td><td>${r.person_time} ${r.time_unit}</td></tr>
      <tr><td>Incidence Rate</td><td>${fmt(r.incidence_rate,5)} per ${r.time_unit}</td></tr>
      <tr><td>IR per 1,000 ${r.time_unit}</td><td>${fmt(r.ir_per_1000,3)}</td></tr>
      <tr><td>95% CI (per 1,000)</td><td>${fmt(r.ci_95_per_1000[0],3)} – ${fmt(r.ci_95_per_1000[1],3)}</td></tr>
    </tbody></table>`;
  if (r.comparison) {
    const comp = r.comparison;
    html += `<p class="fw-semibold mt-3">Comparison</p>
      <table class="table table-sm table-bordered"><tbody>
        <tr><td>IR group 2</td><td>${fmt(comp.ir_per_1000,3)} per 1,000</td></tr>
        <tr><td>Incidence Rate Ratio</td><td>${fmt(comp.irr,3)} (95% CI: ${fmt(comp.irr_ci_95[0],3)}–${fmt(comp.irr_ci_95[1],3)})</td></tr>
        <tr><td>p-value</td><td class="${pClass(comp.p_value)}">${pFmt(comp.p_value)}</td></tr>
      </tbody></table>
      ${sigBadge(comp.p_value)}`;
  }
  $('ir-stats').innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════
// BIOMARKER — ROC
// ══════════════════════════════════════════════════════════════════════
let bioData = null;

function _applyBioData(data) {
  bioData = data;
  populateSelect($('bio-col-marker'), data.columns.filter(c => c.col_type === 'numeric'));
  populateSelect($('bio-col-outcome'), data.columns.filter(c => c.col_type === 'numeric'));
  $('bio-col-map').style.display = 'block';
}

initUploadZone('bio-upload-zone', 'bio-file', async file => {
  try {
    const raw = await uploadFile('/api/data/upload', file);
    _applyBioData(raw);
    const zone = $('bio-upload-zone');
    zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${raw.n_rows} rows)`;
    _addPreviewBtn(zone, raw, file.name, d => {
      _applyBioData(d);
      zone.querySelector('.fw-semibold').textContent = `✓ ${file.name} (${d.n_rows} rows selected)`;
    });
  } catch(e) { alert(e.message); }
});

$('bio-run')._origLabel = $('bio-run').innerHTML;
$('bio-run').addEventListener('click', async () => {
  const btn = $('bio-run');
  setRunning(btn, true);
  try {
    let marker, outcome;
    const activePane = document.querySelector('#bio-csv.data-pane.active, #bio-manual.data-pane.active');
    if (activePane?.id === 'bio-csv' && bioData) {
      const mCol = $('bio-col-marker').value, oCol = $('bio-col-outcome').value;
      marker = bioData.data.map(r => parseFloat(r[mCol]));
      outcome = bioData.data.map(r => parseInt(r[oCol]));
    } else {
      marker = parseNums($('bio-markers').value);
      outcome = parseNums($('bio-outcomes').value).map(Math.round);
    }
    const thresh = $('bio-threshold').value ? parseFloat($('bio-threshold').value) : null;
    const result = await postJSON('/api/biomarker/roc', {marker, outcome, marker_name:$('bio-name').value, threshold:thresh, positive_direction:$('bio-direction').value});
    renderROC(result);
  } catch(err) {
    $('bio-placeholder').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    $('bio-placeholder').style.display = 'block';
    $('bio-results').classList.remove('show');
  } finally { setRunning(btn, false); }
});

function renderROC(r) {
  $('bio-placeholder').style.display = 'none';
  $('bio-results').classList.add('show');

  Plotly.newPlot('bio-roc-plot', [
    {x:r.roc_curve.fpr, y:r.roc_curve.tpr, type:'scatter', mode:'lines', name:`AUC = ${r.auc.toFixed(3)}`,
     line:{color:COLORS[0], width:2.5}, fill:'tozeroy', fillcolor:COLORS[0]+'18'},
    {x:[0,1], y:[0,1], mode:'lines', line:{dash:'dash', color:'#9ca3af', width:1}, name:'Random', showlegend:false},
    {x:[1-r.optimal_threshold.specificity], y:[r.optimal_threshold.sensitivity], mode:'markers', name:'Optimal threshold',
     marker:{size:12, color:COLORS[2], symbol:'star'}},
  ], {
    ...LAYOUT_BASE,
    xaxis:{title:'1 − Specificity (FPR)', range:[0,1]},
    yaxis:{title:'Sensitivity (TPR)', range:[0,1.02]},
    shapes:[{type:'line', x0:0, y0:0, x1:1, y1:1, line:{color:'#d1d5db', dash:'dash', width:1}}],
  }, PLOTLY_CFG);

  // Sens/spec table
  const tbl = r.sens_spec_table;
  $('bio-table').innerHTML = `<div style="overflow-x:auto"><table class="table table-sm table-bordered">
    <thead class="table-light"><tr><th>Threshold</th><th>Sensitivity</th><th>Specificity</th><th>PPV</th><th>NPV</th><th>Accuracy</th></tr></thead>
    <tbody>${tbl.map(row => `<tr>
      <td>${fmt(row.threshold,3)}</td><td>${(row.sensitivity*100).toFixed(1)}%</td><td>${(row.specificity*100).toFixed(1)}%</td>
      <td>${(row.ppv*100).toFixed(1)}%</td><td>${(row.npv*100).toFixed(1)}%</td><td>${(row.accuracy*100).toFixed(1)}%</td></tr>`).join('')}
    </tbody></table></div>`;

  const opt = r.optimal_threshold;
  let html = `
    <div class="d-flex flex-wrap gap-2 mb-3">
      ${badge('AUC = '+r.auc.toFixed(3), r.auc >= 0.7 ? 'success' : 'danger')}
      ${badge('95% CI: '+fmt(r.auc_ci_95[0],3)+' – '+fmt(r.auc_ci_95[1],3))}
      ${badge('p = '+pFmt(r.auc_p), r.auc_p < 0.05 ? 'success' : 'danger')}
    </div>
    <p><em>${r.auc_interpretation}</em></p>
    <p class="fw-semibold">Optimal Threshold (Youden's J = ${fmt(opt.youden_index,3)})</p>
    <table class="table table-sm table-bordered">
      <thead class="table-light"><tr><th>Threshold</th><th>Sensitivity</th><th>Specificity</th><th>PPV</th><th>NPV</th><th>+LR</th><th>−LR</th></tr></thead>
      <tbody><tr>
        <td>${fmt(opt.value,4)}</td>
        <td>${(opt.sensitivity*100).toFixed(1)}%</td>
        <td>${(opt.specificity*100).toFixed(1)}%</td>
        <td>${(opt.ppv*100).toFixed(1)}%</td>
        <td>${(opt.npv*100).toFixed(1)}%</td>
        <td>${opt.positive_lr!=null ? fmt(opt.positive_lr,2) : 'N/A'}</td>
        <td>${opt.negative_lr!=null ? fmt(opt.negative_lr,3) : 'N/A'}</td>
      </tr></tbody></table>`;

  if (r.selected_threshold) {
    const sel = r.selected_threshold;
    html += `<p class="fw-semibold mt-2">Selected Threshold = ${fmt(sel.threshold,4)}</p>
      <table class="table table-sm table-bordered">
        <thead class="table-light"><tr><th>TP</th><th>FP</th><th>TN</th><th>FN</th><th>Sensitivity</th><th>Specificity</th></tr></thead>
        <tbody><tr><td>${sel.tp}</td><td>${sel.fp}</td><td>${sel.tn}</td><td>${sel.fn}</td>
          <td>${(sel.sensitivity*100).toFixed(1)}%</td><td>${(sel.specificity*100).toFixed(1)}%</td></tr></tbody></table>`;
  }
  $('bio-stats').innerHTML = html;
}

// Math.erf polyfill for power curve
Math.erf = Math.erf || function(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.sign(x) * y;
};
