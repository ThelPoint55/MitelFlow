'use strict';

const RFC = (() => {
  const $ = id => document.getElementById(id);
  const TEMPLATE_KEY    = 'rfc_template_b64';
  const formKey         = cardId => `rfc_form_${cardId || 'manual'}`;
  const ROLLBACK_DEFAULT = 'Regressar os Scripts e Promtps para as versões anteriores ao inicio da GMUD.';
  const TECNICO_DEFAULT  = 'Atualização dos Scripts e Promtps das tabelas acima no ambiente de Produção.';

  let templateBase64 = null;
  let _currentCardId = null;
  let _saveTimer     = null;

  function autoSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveForm, 600);
  }

  function saveForm() {
    const state = {
      projeto:       $('rfc-projeto').value,
      ura:           $('rfc-ura').value,
      data:          $('rfc-data').value,
      numero:        $('rfc-numero').value,
      solicitante:   $('rfc-solicitante').value,
      local:         $('rfc-local').value,
      atividade:     $('rfc-atividade').value,
      motivo:        $('rfc-motivo').value,
      riscos:        $('rfc-riscos').value,
      scripts:       getScriptRows(true),
      prompts:       getPromptRows(true),
      planTecnico:   getPlanRows('plan-tecnico-tbody',  true),
      planTestes:    getPlanRows('plan-testes-tbody',   true),
      planRollback:  getPlanRows('plan-rollback-tbody', true),
    };
    try { localStorage.setItem(formKey(_currentCardId), JSON.stringify(state)); } catch (_) {}
  }

  function restoreForm(state) {
    if (!state) return;
    const fields = {
      'rfc-projeto': state.projeto, 'rfc-ura': state.ura,
      'rfc-data': state.data, 'rfc-numero': state.numero, 'rfc-solicitante': state.solicitante,
      'rfc-local': state.local, 'rfc-atividade': state.atividade,
      'rfc-motivo': state.motivo, 'rfc-riscos': state.riscos,
    };
    for (const [id, val] of Object.entries(fields)) {
      if (val !== undefined && val !== null) $(id).value = val;
    }
    if (state.scripts && state.scripts.length) {
      $('scripts-tbody').innerHTML = '';
      state.scripts.forEach(s => addScriptRow(s));
    }
    if (state.prompts && state.prompts.length) {
      $('prompts-tbody').innerHTML = '';
      state.prompts.forEach(p => addPromptRow(p));
    }
    const planMap = {
      planTecnico:  'plan-tecnico-tbody',
      planTestes:   'plan-testes-tbody',
      planRollback: 'plan-rollback-tbody',
    };
    for (const [key, tbodyId] of Object.entries(planMap)) {
      if (state[key] && state[key].length) {
        $(tbodyId).innerHTML = '';
        state[key].forEach(r => addPlanRow(tbodyId, r));
      }
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _currentCardId = new URLSearchParams(location.search).get('card');

    if (_currentCardId) {
      const card = Storage.getCardById(_currentCardId);
      card ? prefillFromCard(card) : showNoCard();
    } else {
      showNoCard();
    }

    // Tenta restaurar estado salvo; se não tiver, adiciona linhas vazias
    const saved = localStorage.getItem(formKey(_currentCardId));
    const state = saved ? JSON.parse(saved) : null;
    if (state) {
      restoreForm(state);
      // Garante que o número da RFC sempre reflita a data atual
      const dateVal = $('rfc-data').value;
      if (dateVal) $('rfc-numero').value = dateVal.replace(/-/g, '');
      if (!state.scripts      || !state.scripts.length)      addScriptRow();
      if (!state.prompts      || !state.prompts.length)      addPromptRow();
      if (!state.planTecnico  || !state.planTecnico.length)  addPlanRow('plan-tecnico-tbody');
      if (!state.planTestes   || !state.planTestes.length)   addPlanRow('plan-testes-tbody');
      if (!state.planRollback || !state.planRollback.length) addPlanRow('plan-rollback-tbody', { atividade: ROLLBACK_DEFAULT });
    } else {
      addScriptRow();
      addPromptRow();
      addPlanRow('plan-tecnico-tbody');
      addPlanRow('plan-testes-tbody');
      addPlanRow('plan-rollback-tbody', { atividade: ROLLBACK_DEFAULT });
    }

    loadSavedTemplate();
    bindEvents();
  }

  // ── Prompts ───────────────────────────────────────────────────────────────
  function addPromptRow(data = {}) {
    const tbody = $('prompts-tbody');
    const tr    = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" placeholder="Nome do prompt" autocomplete="off"></td>
      <td><input type="text" placeholder="Ambiente" autocomplete="off"></td>
      <td class="td-del"><button type="button" class="btn-del-row" title="Remover">✕</button></td>
    `;
    const inputs = tr.querySelectorAll('input');
    if (data.nome)     inputs[0].value = data.nome;
    if (data.ambiente) inputs[1].value = data.ambiente;
    tr.querySelector('.btn-del-row').addEventListener('click', () => {
      if ($('prompts-tbody').rows.length > 1) { tr.remove(); autoSave(); }
    });
    tbody.appendChild(tr);
  }

  function getPromptRows(includeEmpty = false) {
    return [...$('prompts-tbody').rows].map(tr => {
      const inputs = tr.querySelectorAll('input');
      return { nome: inputs[0].value.trim(), ambiente: inputs[1].value.trim() };
    }).filter(r => includeEmpty || r.nome || r.ambiente);
  }

  // ── Planos RFC ────────────────────────────────────────────────────────────
  function addPlanRow(tbodyId, data = {}) {
    const tbody = $(tbodyId);
    const tr    = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="datetime-local"></td>
      <td><input type="time" step="1" style="width:96px"></td>
      <td><input type="text" placeholder="Atividade" autocomplete="off"></td>
      <td>
        <select>
          <option value="">—</option>
          <option value="Pan">Pan</option>
          <option value="Unify">Unify</option>
        </select>
      </td>
      <td class="td-del"><button type="button" class="btn-del-row" title="Remover">✕</button></td>
    `;
    const inputs = tr.querySelectorAll('input, select');
    if (data.inicio)      inputs[0].value = data.inicio;
    if (data.duracao)     inputs[1].value = data.duracao;
    const defaultAtiv = tbodyId === 'plan-rollback-tbody' ? ROLLBACK_DEFAULT
                      : tbodyId === 'plan-tecnico-tbody'  ? TECNICO_DEFAULT
                      : '';
    inputs[2].value = data.atividade || defaultAtiv;
    if (data.responsavel) inputs[3].value = data.responsavel;
    tr.querySelector('.btn-del-row').addEventListener('click', () => {
      if (tbody.rows.length > 1) { tr.remove(); autoSave(); }
    });
    tbody.appendChild(tr);
  }

  function getPlanRows(tbodyId, includeEmpty = false) {
    return [...$(tbodyId).rows].map(tr => {
      const fields = tr.querySelectorAll('input, select');
      return {
        inicio:      fields[0].value,
        duracao:     fields[1].value.trim(),
        atividade:   fields[2].value.trim(),
        responsavel: fields[3].value.trim(),
      };
    }).filter(r => includeEmpty || r.inicio || r.duracao || r.atividade || r.responsavel);
  }

  // ── Scripts Afetados ──────────────────────────────────────────────────────
  function addScriptRow(data = {}) {
    const tbody = $('scripts-tbody');
    const tr    = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text"     placeholder="Nome do script" autocomplete="off"></td>
      <td><input type="text"     placeholder="BU / Ambiente" autocomplete="off"></td>
      <td><input type="datetime-local"></td>
      <td>
        <select>
          <option value="">—</option>
          <option value="Sim">Sim</option>
          <option value="Não">Não</option>
        </select>
      </td>
      <td class="td-del"><button type="button" class="btn-del-row" title="Remover">✕</button></td>
    `;
    const inputs = tr.querySelectorAll('input, select');
    if (data.nome)     inputs[0].value = data.nome;
    if (data.ambiente) inputs[1].value = data.ambiente;
    if (data.dataHora) inputs[2].value = data.dataHora;
    if (data.audio)    inputs[3].value = data.audio;
    tr.querySelector('.btn-del-row').addEventListener('click', () => {
      if ($('scripts-tbody').rows.length > 1) { tr.remove(); autoSave(); }
    });
    tbody.appendChild(tr);
  }

  function getScriptRows(includeEmpty = false) {
    return [...$('scripts-tbody').rows].map(tr => {
      const inputs = tr.querySelectorAll('input, select');
      return {
        nome:     inputs[0].value.trim(),
        ambiente: inputs[1].value.trim(),
        dataHora: inputs[2].value,
        audio:    inputs[3].value,
      };
    }).filter(r => includeEmpty || r.nome || r.ambiente);
  }

  // ── Card pre-fill ─────────────────────────────────────────────────────────
  function prefillFromCard(card) {
    $('origem-title').textContent = card.title || '—';

    const meta    = [];
    if (card.deadline) meta.push('Deadline: ' + new Date(card.deadline + 'T00:00:00').toLocaleDateString('pt-BR'));
    const members  = Storage.getMembers();
    const cardMems = (card.memberIds || []).map(id => members.find(m => m.id === id)).filter(Boolean);
    if (cardMems.length) meta.push('Membros: ' + cardMems.map(m => m.name).join(', '));
    $('origem-meta').textContent = meta.join(' · ') || 'Card do Kanban';

    $('rfc-projeto').value = card.title || '';
    if (card.deadline) {
      $('rfc-data').value   = card.deadline;
      $('rfc-numero').value = card.deadline.replace(/-/g, '');
    }
  }

  function showNoCard() {
    $('rfc-origem').classList.add('no-card');
    $('origem-title').textContent = 'Nenhum card selecionado';
    $('origem-meta').textContent  = 'Formulário aberto sem dados pré-preenchidos';
  }

  // ── Template management ───────────────────────────────────────────────────
  function loadSavedTemplate() {
    // 1. Prioridade: template embutido no código (rfc-template-data.js)
    if (typeof RFC_TEMPLATE_DEFAULT !== 'undefined' && RFC_TEMPLATE_DEFAULT) {
      templateBase64 = RFC_TEMPLATE_DEFAULT;
      showTemplateLoaded('Template padrão (embutido no app)');
      $('btn-download').disabled = false;
      $('btn-embed-template').style.display = 'none';
      return;
    }
    // 2. Fallback: localStorage
    const saved = localStorage.getItem(TEMPLATE_KEY);
    if (saved) {
      templateBase64 = saved;
      showTemplateLoaded('Template RFC salvo (carregado automaticamente)');
      $('btn-download').disabled = false;
    }
  }

  function embedTemplate() {
    if (!templateBase64) return;
    const js  = `// Template RFC embutido — gerado automaticamente\nconst RFC_TEMPLATE_DEFAULT = '${templateBase64}';\n`;
    const blob = new Blob([js], { type: 'text/javascript' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'rfc-template-data.js' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('embed-instructions').style.display = 'block';
    showToast('Arquivo gerado! Mova-o para a pasta js/.', 'success');
  }

  function loadTemplate(file) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showToast('Selecione um arquivo .xlsx', 'warning');
      return;
    }
    const reader  = new FileReader();
    reader.onload = e => {
      const bytes = new Uint8Array(e.target.result);
      let binary  = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      templateBase64 = btoa(binary);
      try { localStorage.setItem(TEMPLATE_KEY, templateBase64); } catch (_) {}
      showTemplateLoaded(file.name);
      $('btn-download').disabled = false;
      showToast('Template carregado com sucesso.', 'success');
    };
    reader.readAsArrayBuffer(file);
  }

  function showTemplateLoaded(name) {
    $('tpl-dropzone').style.display = 'none';
    $('tpl-loaded').classList.add('visible');
    $('tpl-loaded-name').textContent = name;
  }

  function clearTemplate() {
    try { localStorage.removeItem(TEMPLATE_KEY); } catch (_) {}
    templateBase64 = null;
    $('tpl-dropzone').style.display = '';
    $('tpl-loaded').classList.remove('visible');
    $('btn-download').disabled = true;
    showToast('Template removido.', 'info');
  }

  // ── Download (JSZip — edição cirúrgica do XML) ─────────────────────────────
  async function downloadRFC() {
    if (!templateBase64) {
      showToast('Carregue o template RFC antes de baixar.', 'warning');
      return;
    }

    const projeto     = $('rfc-projeto').value.trim();
    const ura         = $('rfc-ura').value;
    const data        = $('rfc-data').value;
    const numero      = $('rfc-numero').value.trim();
    const solicitante = $('rfc-solicitante').value.trim();
    const local       = $('rfc-local').value.trim();
    const atividade   = $('rfc-atividade').value.trim();
    const motivo      = $('rfc-motivo').value.trim();
    const riscos      = $('rfc-riscos').value.trim();

    if (!projeto) {
      showToast('O campo Projeto é obrigatório.', 'warning');
      $('rfc-projeto').focus();
      return;
    }

    const btn = $('btn-download');
    btn.disabled    = true;
    btn.textContent = '⏳ Gerando...';

    try {
      const zip = await JSZip.loadAsync(templateBase64, { base64: true });

      // Mapa de células a substituir (apenas texto)
      const strMods = {};
      const numMods = {}; // valores numéricos (tempo, etc.)
      if (projeto)     strMods['G6']  = projeto;
      if (ura)         strMods['AG6'] = ura;
      if (solicitante) strMods['J9']  = solicitante;
      if (local)       strMods['C21'] = local;
      if (atividade)   strMods['C24'] = atividade;
      if (motivo)      strMods['C27'] = motivo;
      if (riscos)      strMods['C30'] = riscos;

      // Scripts Afetados — primeira linha de dados: 34
      const scripts = getScriptRows();
      scripts.forEach((s, i) => {
        const row = 34 + i;
        if (s.nome)     strMods[`C${row}`]  = s.nome;
        if (s.ambiente) strMods[`O${row}`]  = s.ambiente;
        if (s.dataHora) strMods[`V${row}`]  = formatDateTimeLocal(s.dataHora);
        if (s.audio)    strMods[`AH${row}`] = s.audio;
      });

      // Prompts — primeira linha de dados: 83
      const prompts = getPromptRows();
      prompts.forEach((p, i) => {
        const row = 83 + i;
        if (p.nome)     strMods[`C${row}`] = p.nome;
        if (p.ambiente) strMods[`R${row}`] = p.ambiente;
      });

      // Plano Técnico da Atividade — primeira linha: 107
      getPlanRows('plan-tecnico-tbody').forEach((r, i) => {
        const row = 107 + i;
        if (r.inicio)      strMods[`C${row}`]  = formatDateTimeLocal(r.inicio);
        if (r.duracao)     numMods[`H${row}`]  = timeToFraction(r.duracao);
        if (r.atividade)   strMods[`L${row}`]  = r.atividade;
        if (r.responsavel) strMods[`AF${row}`] = r.responsavel;
      });

      // Plano de Testes — primeira linha: 113
      getPlanRows('plan-testes-tbody').forEach((r, i) => {
        const row = 113 + i;
        if (r.inicio)      strMods[`C${row}`]  = formatDateTimeLocal(r.inicio);
        if (r.duracao)     numMods[`H${row}`]  = timeToFraction(r.duracao);
        if (r.atividade)   strMods[`L${row}`]  = r.atividade;
        if (r.responsavel) strMods[`AF${row}`] = r.responsavel;
      });

      // Plano de Roll Back — primeira linha: 120
      getPlanRows('plan-rollback-tbody').forEach((r, i) => {
        const row = 120 + i;
        if (r.inicio)      strMods[`C${row}`]  = formatDateTimeLocal(r.inicio);
        if (r.duracao)     numMods[`H${row}`]  = timeToFraction(r.duracao);
        if (r.atividade)   strMods[`L${row}`]  = r.atividade;
        if (r.responsavel) strMods[`AF${row}`] = r.responsavel;
      });

      // Janela Operacional Prevista
      const allPlanRows = [
        ...getPlanRows('plan-tecnico-tbody'),
        ...getPlanRows('plan-testes-tbody'),
        ...getPlanRows('plan-rollback-tbody'),
      ].filter(r => r.inicio);
      if (allPlanRows.length > 0) {
        const first       = allPlanRows[0];
        const last        = allPlanRows[allPlanRows.length - 1];
        const firstSerial = datetimeToExcelSerial(first.inicio);
        const lastSerial  = datetimeToExcelSerial(last.inicio) + timeToFraction(last.duracao);
        numMods['X125']  = Math.floor(firstSerial);
        numMods['AI125'] = Math.floor(lastSerial);
        numMods['X126']  = firstSerial - Math.floor(firstSerial);
        numMods['AI126'] = lastSerial  - Math.floor(lastSerial);
      }

      await patchWorkbook(zip, strMods, numMods, data || null, numero || null);

      const today    = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      const safeName = projeto.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
      const blob     = await zip.generateAsync({
        type:        'blob',
        mimeType:    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        compression: 'DEFLATE',
      });

      const url = URL.createObjectURL(blob);
      const a   = Object.assign(document.createElement('a'), {
        href: url, download: `RFC_${safeName}_${today}.xlsx`,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      showToast('RFC baixado com sucesso!', 'success');
    } catch (err) {
      console.error('RFC error:', err);
      showToast('Erro: ' + (err && err.message ? err.message : String(err)), 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = '📥 Baixar RFC Preenchido (.xlsx)';
    }
  }

  // ── Patch workbook ────────────────────────────────────────────────────────
  async function patchWorkbook(zip, strMods, numMods, dateStr, rfcNumero) {
    const wsFile = zip.file('xl/worksheets/sheet1.xml');
    if (!wsFile) return;
    let ws = await wsFile.async('string');

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function colToNum(col) {
      let n = 0;
      for (let i = 0; i < col.length; i++) n = n * 26 + col.charCodeAt(i) - 64;
      return n;
    }
    function extractStyle(cellStr) {
      const m = cellStr.match(/\bs="(\d+)"/);
      return m ? ` s="${m[1]}"` : '';
    }

    // Substitui célula inteira — mais seguro que modificar o interior
    function replaceCell(ref, newCellXml) {
      // Tenta self-closing: <c r="REF" .../>
      const scRe = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*/>`);
      if (scRe.test(ws)) {
        ws = ws.replace(scRe, () => newCellXml);
        return true;
      }
      // Tenta com conteúdo: <c r="REF" ...>...</c>
      const ocRe = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*>[\\s\\S]*?<\\/c>`);
      if (ocRe.test(ws)) {
        ws = ws.replace(ocRe, () => newCellXml);
        return true;
      }
      return false;
    }

    // Injeta célula em linha existente ou cria nova linha
    function injectCell(ref, newCellXml) {
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (!m) return;
      const colIdx = colToNum(m[1]);
      const rowNum = m[2];

      const rowRe    = new RegExp(`(<row\\b[^>]*\\br="${rowNum}"[^>]*>)([\\s\\S]*?)(<\\/row>)`);
      const rowMatch = ws.match(rowRe);
      if (rowMatch) {
        let inner  = rowMatch[2];
        let placed = false;
        inner = inner.replace(
          new RegExp(`<c\\b[^>]*\\br="([A-Z]+)\\d+"(?:[^/]*/>|[^>]*>[\\s\\S]*?<\\/c>)`, 'g'),
          (cm, cCol) => {
            if (!placed && colToNum(cCol) > colIdx) { placed = true; return newCellXml + cm; }
            return cm;
          }
        );
        if (!placed) inner += newCellXml;
        const r1 = rowMatch[1], r3 = rowMatch[3];
        ws = ws.replace(rowRe, () => r1 + inner + r3);
      } else {
        const newRow = `<row r="${rowNum}">${newCellXml}</row>`;
        let   placed = false;
        ws = ws.replace(/<row\b[^>]*\br="(\d+)"/g, (m2, n) => {
          if (!placed && parseInt(n, 10) > parseInt(rowNum, 10)) { placed = true; return newRow + m2; }
          return m2;
        });
        if (!placed) ws = ws.replace(/<\/sheetData>/, newRow + '</sheetData>');
      }
    }

    // ── Células de texto ──────────────────────────────────────────────
    for (const [ref, val] of Object.entries(strMods)) {
      if (!val) continue;
      const escaped = esc(val);
      const existRe  = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?<\\/c>)`);
      const existing = ws.match(existRe);
      const sAttr    = existing ? extractStyle(existing[0]) : '';
      const newCell  = `<c r="${ref}"${sAttr} t="str"><v>${escaped}</v></c>`;
      const replaced = replaceCell(ref, newCell);
      if (!replaced) injectCell(ref, newCell);
    }

    // ── Células numéricas (tempo, etc.) — preserva formatação da célula ─
    for (const [ref, val] of Object.entries(numMods)) {
      if (val === undefined || val === null) continue;
      const existRe  = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?<\\/c>)`);
      const existing = ws.match(existRe);
      const sAttr    = existing ? extractStyle(existing[0]) : '';
      const newCell  = `<c r="${ref}"${sAttr}><v>${val}</v></c>`;
      const replaced = replaceCell(ref, newCell);
      if (!replaced) injectCell(ref, newCell);
    }

    // ── Data de Execução (C9) — serial numérico ───────────────────────
    if (dateStr) {
      const serial   = String(dateToExcelSerial(dateStr));
      const existRe  = new RegExp(`<c\\b[^>]*\\br="C9"[^>]*(?:/>|>[\\s\\S]*?<\\/c>)`);
      const existing = ws.match(existRe);
      const sAttr    = existing ? extractStyle(existing[0]) : '';
      const newCell  = `<c r="C9"${sAttr}><v>${serial}</v></c>`;
      if (!replaceCell('C9', newCell)) injectCell('C9', newCell);
    }

    // ── Número da RFC (AG2) — valor numérico, sem alerta "texto" ────────
    if (rfcNumero) {
      const existRe = new RegExp(`<c\\b[^>]*\\br="AG2"[^>]*(?:/>|>[\\s\\S]*?<\\/c>)`);
      const existing = ws.match(existRe);
      const sAttr   = existing ? extractStyle(existing[0]) : '';
      const newCell = `<c r="AG2"${sAttr} t="str"><v>${rfcNumero}</v></c>`;
      if (!replaceCell('AG2', newCell)) injectCell('AG2', newCell);
    }

    // Força recálculo completo ao abrir — sem isso o Excel usa cache das fórmulas
    const wbFile = zip.file('xl/workbook.xml');
    if (wbFile) {
      let wb = await wbFile.async('string');
      wb = wb.replace(/<calcPr\b([^/]*)\/>/,
        (_, attrs) => `<calcPr${attrs.replace(/\bfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
      if (!/<calcPr\b/.test(wb)) {
        wb = wb.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
      }
      zip.file('xl/workbook.xml', wb);
    }

    if (zip.file('xl/calcChain.xml')) zip.remove('xl/calcChain.xml');
    zip.file('xl/worksheets/sheet1.xml', ws);
  }

  // Converte "YYYY-MM-DDTHH:mm[:ss]" → "DD/MM/YYYY HH:mm"
  function formatDateTimeLocal(val) {
    if (!val) return val;
    const [datePart, timePart = ''] = val.split('T');
    const [y, m, d] = datePart.split('-');
    const tp = timePart.split(':');
    const hh = tp[0] || '00';
    const mm = tp[1] || '00';
    return `${d}/${m}/${y} ${hh}:${mm}`;
  }

  // Converte "HH:mm:ss" para fração de dia do Excel (ex: "01:30:00" → 0.0625)
  function timeToFraction(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    const h = parts[0] || 0, m = parts[1] || 0, s = parts[2] || 0;
    return h / 24 + m / 1440 + s / 86400;
  }

  // Converte "YYYY-MM-DDTHH:mm" para serial datetime do Excel (data + fração de hora)
  function datetimeToExcelSerial(datetimeStr) {
    if (!datetimeStr) return null;
    const [datePart, timePart = '00:00'] = datetimeStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm]  = (timePart || '00:00').split(':').map(Number);
    const days = (Date.UTC(y, m - 1, d) + 2209161600000) / 86400000;
    return days + hh / 24 + mm / 1440;
  }

  // Converte "YYYY-MM-DD" para serial do Excel com horário fixo 22:00
  function dateToExcelSerial(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    // Epoch Excel = 1899-12-30 = -2209161600000 ms (constante UTC conhecida)
    const days = (Date.UTC(y, m - 1, d) + 2209161600000) / 86400000;
    return days + 22 / 24;
  }

  // ── Clear form ────────────────────────────────────────────────────────────
  function clearForm() {
    ['rfc-projeto', 'rfc-solicitante', 'rfc-local', 'rfc-motivo'].forEach(id => $(id).value = '');
    $('rfc-atividade').value = 'Atualização de Script no ambiente de Produção.';
    $('rfc-ura').value    = '';
    $('rfc-data').value   = '';
    $('rfc-riscos').value = 'Não são esperados riscos com a implantação deste projeto.';
    $('scripts-tbody').innerHTML = '';
    addScriptRow();
    $('prompts-tbody').innerHTML = '';
    addPromptRow();
    ['plan-tecnico-tbody', 'plan-testes-tbody'].forEach(id => {
      $(id).innerHTML = '';
      addPlanRow(id);
    });
    $('plan-rollback-tbody').innerHTML = '';
    addPlanRow('plan-rollback-tbody', { atividade: ROLLBACK_DEFAULT });
    try { localStorage.removeItem(formKey(_currentCardId)); } catch (_) {}
  }

  // ── Bind events ───────────────────────────────────────────────────────────
  function bindEvents() {
    const fileInput = $('tpl-file-input');
    const dropzone  = $('tpl-dropzone');

    dropzone.addEventListener('dragover',  e  => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) loadTemplate(file);
    });
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) {
        loadTemplate(file);
        fileInput.value = '';
      }
    });

    // Auto-preenchimento do Número da RFC a partir da data
    $('rfc-data').addEventListener('change', () => {
      const val = $('rfc-data').value;
      if (val) $('rfc-numero').value = val.replace(/-/g, '');
    });

    // Auto-save em qualquer campo do formulário
    document.querySelector('main').addEventListener('input',  autoSave);
    document.querySelector('main').addEventListener('change', autoSave);

    $('btn-add-script').addEventListener('click',        () => { addScriptRow(); autoSave(); });
    $('btn-add-prompt').addEventListener('click',        () => { addPromptRow(); autoSave(); });
    $('btn-add-plan-tecnico').addEventListener('click',  () => { addPlanRow('plan-tecnico-tbody');  autoSave(); });
    $('btn-add-plan-testes').addEventListener('click',   () => { addPlanRow('plan-testes-tbody');   autoSave(); });
    $('btn-add-plan-rollback').addEventListener('click', () => { addPlanRow('plan-rollback-tbody', { atividade: ROLLBACK_DEFAULT }); autoSave(); });
    $('btn-embed-template').addEventListener('click', embedTemplate);
    $('btn-clear-template').addEventListener('click', clearTemplate);
    $('btn-download').addEventListener('click',       () => downloadRFC());
    $('btn-clear-form').addEventListener('click',     clearForm);
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className   = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2800);
    setTimeout(() => el.remove(), 3200);
  }

  document.addEventListener('DOMContentLoaded', init);
  return {};
})();
