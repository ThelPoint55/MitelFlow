'use strict';

const Utils = (() => {

  function generateUUID() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatDateTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function exportToJSON(project, filename) {
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `qa-${project.name.replace(/\s+/g, '-')}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Retorna 0 (not_tested), 0.5 (parcial/divergência) ou 1 (validado/aprovado)
  function getSectionScore(sectionStatus) {
    if (sectionStatus === 'validated' || sectionStatus === 'approved') return 1;
    if (sectionStatus === 'divergence' || sectionStatus === 'pending_evidence') return 0.5;
    return 0;
  }

  function calculateSectionStatus(items, statusField, approvedValue, divergenceValue) {
    if (!items || items.length === 0) return 'not_tested';
    const statuses = items.map(i => i[statusField]);
    if (statuses.every(s => s === approvedValue)) return 'validated';
    if (statuses.some(s => s === divergenceValue || s === 'divergence' || s === 'rejected' || s === 'incorrect' || s === 'missing')) return 'divergence';
    if (statuses.some(s => s === approvedValue || s === 'correct')) return 'divergence'; // partial
    return 'not_tested';
  }

  function calculateUXStatus(uxFlows) {
    return calculateSectionStatus(uxFlows.flows, 'status', 'validated', 'divergence');
  }

  function calculateBIStatus(biMarkings) {
    return calculateSectionStatus(biMarkings.integrationPoints, 'homologationStatus', 'approved', 'rejected');
  }

  function calculateDevStatus(devMarkings) {
    const soaStatuses = (devMarkings.soaErrors || []).map(e => e.markingStatus);
    const tagStatuses = (devMarkings.tags || []).map(t => t.status);
    const all = [...soaStatuses, ...tagStatuses];
    if (all.length === 0) return 'not_tested';
    if (all.every(s => s === 'correct')) return 'validated';
    if (all.some(s => s === 'incorrect' || s === 'missing')) return 'divergence';
    if (all.some(s => s === 'correct')) return 'divergence';
    return 'not_tested';
  }

  function calculateHomolStatus(homol) {
    if (homol.status === 'approved') return 'approved';
    if (homol.status === 'rejected') return 'rejected';
    if (homol.status === 'pending_evidence') return 'pending_evidence';
    return 'not_tested';
  }

  function calculateProgress(project) {
    const s1 = getSectionScore(calculateUXStatus(project.uxFlows));
    const s2 = getSectionScore(calculateBIStatus(project.biMarkings));
    const s3 = getSectionScore(calculateDevStatus(project.devMarkings));
    const s4 = getSectionScore(calculateHomolStatus(project.functionalHomologation));
    return Math.round(((s1 + s2 + s3 + s4) / 4) * 100);
  }

  function statusLabel(status) {
    const map = {
      not_tested: 'Não testado',
      validated: 'Validado',
      divergence: 'Divergência',
      approved: 'Aprovado',
      rejected: 'Rejeitado',
      pending_evidence: 'Aguard. Evidência',
      correct: 'Correto',
      incorrect: 'Incorreto',
      missing: 'Ausente',
      not_checked: 'Não verificado',
      pending: 'Pendente',
    };
    return map[status] || status || '—';
  }

  function statusClass(status) {
    const map = {
      validated: 'status-validated',
      approved: 'status-validated',
      correct: 'status-validated',
      divergence: 'status-divergence',
      pending: 'status-divergence',
      pending_evidence: 'status-divergence',
      incorrect: 'status-rejected',
      rejected: 'status-rejected',
      missing: 'status-rejected',
      not_tested: 'status-not-tested',
      not_checked: 'status-not-tested',
    };
    return map[status] || 'status-not-tested';
  }

  function createDefaultProject(name, description) {
    return {
      id: generateUUID(),
      name: name.trim(),
      description: description ? description.trim() : '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      uxFlows: {
        flows: [],
        generalObservation: ''
      },
      biMarkings: {
        integrationPoints: [],
        generalObservation: ''
      },
      devMarkings: {
        soaErrors: [],
        tags: [],
        generalObservation: ''
      },
      functionalHomologation: {
        status: 'not_tested',
        hmlEnvironmentAvailable: null,
        validationType: null,
        evidences: [],
        approvedBy: '',
        approvedAt: '',
        observation: ''
      }
    };
  }

  function generateScopeDocument(project) {
    const changeTypeLabel = { new: 'Novo', modified: 'Modificado', removed: 'Removido', unchanged: 'Sem mudança' };
    const changeTypeBg    = { new: '#e6f4ea', modified: '#fff8e1', removed: '#fdecea', unchanged: '#f1f3f5' };
    const changeTypeColor = { new: '#28a745', modified: '#b87700', removed: '#dc3545', unchanged: '#6c757d' };
    const stLabel = { not_tested: 'Não testado', validated: 'Validado', divergence: 'Divergência' };
    const stBg    = { not_tested: '#f1f3f5', validated: '#e6f4ea', divergence: '#fef9e7' };
    const stColor = { not_tested: '#6c757d', validated: '#28a745', divergence: '#b87700' };

    const now = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    function esc(s) {
      return String(s || '—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    const flows = (project.uxFlows && project.uxFlows.flows) || [];

    const totalFlows    = flows.length;
    const validated     = flows.filter(f => f.status === 'validated').length;
    const divergence    = flows.filter(f => f.status === 'divergence').length;
    const notTested     = flows.filter(f => !f.status || f.status === 'not_tested').length;
    const countNew      = flows.filter(f => f.changeType === 'new').length;
    const countModified = flows.filter(f => f.changeType === 'modified').length;
    const countRemoved  = flows.filter(f => f.changeType === 'removed').length;

    const rows = totalFlows === 0
      ? `<tr><td colspan="6" style="text-align:center;color:#6c757d;padding:24px 12px;">Nenhum fluxo registrado.</td></tr>`
      : flows.map(f => {
          const ct = f.changeType || 'unchanged';
          const st = f.status     || 'not_tested';
          return `
            <tr>
              <td style="font-weight:600;min-width:120px">${esc(f.name)}</td>
              <td style="white-space:nowrap">
                <span style="background:${changeTypeBg[ct]||'#f1f3f5'};color:${changeTypeColor[ct]||'#6c757d'};padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600">
                  ${changeTypeLabel[ct] || ct}
                </span>
              </td>
              <td>${esc(f.v1Description)}</td>
              <td>${esc(f.v2Description)}</td>
              <td style="white-space:nowrap">
                <span style="background:${stBg[st]||'#f1f3f5'};color:${stColor[st]||'#6c757d'};padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600">
                  ${stLabel[st] || st}
                </span>
              </td>
              <td style="color:#6c757d;font-size:0.8125rem">${esc(f.observation)}</td>
            </tr>`;
        }).join('');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Escopo — ${esc(project.name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;color:#1a1d23;background:#f0f2f5;padding:32px 16px}
    .doc-wrap{max-width:980px;margin:0 auto;background:white;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.12);overflow:hidden}
    .doc-header{background:#003087;color:white;padding:32px 40px}
    .doc-header h1{font-size:1.5rem;font-weight:700;margin-bottom:6px}
    .doc-header .sub{font-size:.875rem;opacity:.8;margin-bottom:4px}
    .doc-header .meta{font-size:.75rem;opacity:.6;margin-top:12px}
    .doc-body{padding:32px 40px}
    .section{margin-bottom:32px}
    .section-title{font-size:1rem;font-weight:700;color:#003087;border-bottom:2px solid #e8eef7;padding-bottom:8px;margin-bottom:16px}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:8px}
    .summary-card{background:#f0f2f5;border-radius:8px;padding:14px;text-align:center}
    .summary-card .num{font-size:1.75rem;font-weight:700;color:#003087;line-height:1}
    .summary-card .lbl{font-size:.72rem;color:#6c757d;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:.875rem}
    th{background:#003087;color:white;text-align:left;padding:10px 12px;font-weight:600;font-size:.8125rem}
    th:first-child{border-radius:6px 0 0 0}th:last-child{border-radius:0 6px 0 0}
    td{padding:10px 12px;border-bottom:1px solid #eef0f3;vertical-align:top}
    tr:nth-child(even) td{background:#fafbfc}
    tr:last-child td{border-bottom:none}
    .obs-general{background:#f0f2f5;border-radius:6px;padding:12px 16px;color:#6c757d;font-size:.875rem;font-style:italic;margin-top:16px}
    .doc-footer{background:#f0f2f5;padding:20px 40px;text-align:center;font-size:.75rem;color:#9aa3af;border-top:1px solid #dde1e7}
    @media print{body{background:white;padding:0}.doc-wrap{box-shadow:none;border-radius:0}}
  </style>
</head>
<body>
  <div class="doc-wrap">
    <div class="doc-header">
      <h1>${esc(project.name)}</h1>
      ${project.description ? `<div class="sub">${esc(project.description)}</div>` : ''}
      <div class="meta">Criado em: ${formatDate(project.createdAt)} &nbsp;|&nbsp; Atualizado: ${formatDate(project.updatedAt)}</div>
    </div>
    <div class="doc-body">
      <div class="section">
        <div class="section-title">Resumo dos Fluxos</div>
        <div class="summary-grid">
          <div class="summary-card"><div class="num">${totalFlows}</div><div class="lbl">Total</div></div>
          <div class="summary-card"><div class="num" style="color:#28a745">${validated}</div><div class="lbl">Validados</div></div>
          <div class="summary-card"><div class="num" style="color:#b87700">${divergence}</div><div class="lbl">Divergências</div></div>
          <div class="summary-card"><div class="num" style="color:#6c757d">${notTested}</div><div class="lbl">Não testados</div></div>
          <div class="summary-card"><div class="num" style="color:#28a745">${countNew}</div><div class="lbl">Novos</div></div>
          <div class="summary-card"><div class="num" style="color:#b87700">${countModified}</div><div class="lbl">Modificados</div></div>
          <div class="summary-card"><div class="num" style="color:#dc3545">${countRemoved}</div><div class="lbl">Removidos</div></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Tabela de Mudanças — De-Para (V1 &rarr; V2)</div>
        <table>
          <thead>
            <tr>
              <th>Fluxo</th>
              <th>Tipo de Mudança</th>
              <th>Como era (V1)</th>
              <th>Como ficou (V2)</th>
              <th>Status</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${project.uxFlows.generalObservation
          ? `<div class="obs-general">Obs. geral: ${esc(project.uxFlows.generalObservation)}</div>`
          : ''}
      </div>
    </div>
    <div class="doc-footer">Documento gerado em ${now} pelo QA Dashboard</div>
  </div>
</body>
</html>`;
  }

  // ── Kanban helpers ────────────────────────────────────────────────────────

  const MEMBER_COLORS = [
    '#4A90D9','#7B68EE','#50C878','#FF6B6B','#FFD700',
    '#40E0D0','#FF8C69','#9370DB','#20B2AA','#F4A460',
    '#87CEEB','#DDA0DD',
  ];

  function generateMemberColor(index) {
    return MEMBER_COLORS[index % MEMBER_COLORS.length];
  }

  function getInitials(name) {
    return (name || '')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 0)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('');
  }

  function getDaysUntilDeadline(dateStr) {
    if (!dateStr) return null;
    const today    = new Date(); today.setHours(0,0,0,0);
    const deadline = new Date(dateStr + 'T00:00:00');
    return Math.round((deadline - today) / 86400000);
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return {
    generateUUID,
    formatDate,
    formatDateTime,
    debounce,
    exportToJSON,
    generateScopeDocument,
    calculateProgress,
    calculateUXStatus,
    calculateBIStatus,
    calculateDevStatus,
    calculateHomolStatus,
    statusLabel,
    statusClass,
    createDefaultProject,
    generateMemberColor,
    getInitials,
    getDaysUntilDeadline,
    escHtml,
  };
})();
