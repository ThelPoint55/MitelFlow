'use strict';

const HLDCompare = (() => {

  const API_KEY_STORAGE  = 'hld_compare_api_key';
  const GROQ_MODEL_TECH  = 'llama-3.3-70b-versatile'; // Modelo principal — Product Owner
  const GROQ_ENDPOINT    = 'https://api.groq.com/openai/v1/chat/completions';
  const PDF_WORKER_SRC   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  let currentResult    = '';   // Resultado gerado pelo Product Owner
  let isStreaming      = false;
  let importedText     = '';   // texto completo com marcadores de página
  let importedPages    = [];   // [{ page: n, text: string }, ...]
  let detectedVersion  = null; // { dateStr, description } detectado automaticamente no versionamento

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── API Key ───────────────────────────────────────────────────────────────
  function loadApiKey() {
    $('api-key-input').value = sessionStorage.getItem(API_KEY_STORAGE) || '';
  }

  function saveApiKey() {
    const key = $('api-key-input').value.trim();
    if (!key) { showToast('Digite a chave da API primeiro.', 'warning'); return; }
    sessionStorage.setItem(API_KEY_STORAGE, key);
    showToast('Chave salva com sucesso.', 'success');
  }

  function clearApiKey() {
    sessionStorage.removeItem(API_KEY_STORAGE);
    $('api-key-input').value = '';
    showToast('Chave removida.', 'info');
  }

  function getApiKey() {
    return sessionStorage.getItem(API_KEY_STORAGE) || $('api-key-input').value.trim();
  }

  // ── PDF import ────────────────────────────────────────────────────────────
  async function importPDF(file) {
    if (!file || file.type !== 'application/pdf') {
      showToast('Selecione um arquivo .pdf válido.', 'error');
      return;
    }

    // Configurar PDF.js worker
    if (typeof pdfjsLib === 'undefined') {
      showToast('Biblioteca PDF ainda carregando. Tente novamente em instantes.', 'warning');
      return;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

    $('progress-status').style.display = 'flex';
    $('progress-text').textContent = `Lendo "${file.name}"...`;
    $('btn-generate').disabled = true;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;

      importedPages = [];
      for (let i = 1; i <= totalPages; i++) {
        $('progress-text').textContent = `Extraindo texto — página ${i} de ${totalPages}...`;
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ').trim();
        importedPages.push({ page: i, text: pageText });
      }

      // Reconstrói texto completo com marcadores de página
      importedText = importedPages
        .map(p => `--- PÁGINA ${p.page} ---\n${p.text}`)
        .join('\n\n');

      // Atualizar UI para estado "carregado"
      $('pdf-dropzone').style.display = 'none';
      $('pdf-loaded').classList.add('visible');
      $('pdf-name').textContent = file.name;
      $('pdf-meta').textContent =
        `${totalPages} página${totalPages !== 1 ? 's' : ''} · ${importedText.length.toLocaleString('pt-BR')} caracteres extraídos`;

      $('btn-generate').disabled = false;
      showToast(`PDF importado com sucesso (${totalPages} páginas).`, 'success');

    } catch (err) {
      showToast('Erro ao ler o PDF. Verifique se o arquivo não está protegido por senha.', 'error');
      console.error('[HLDCompare] PDF.js error:', err);
    } finally {
      $('progress-status').style.display = 'none';
    }
  }

  // Normaliza uma data para "DDMMYYYY" para comparação (aceita DD/MM/YY ou DD/MM/YYYY)
  function normDate(dateStr) {
    if (!dateStr) return '';
    const sep   = dateStr.includes('/') ? '/' : '-';
    const parts = dateStr.trim().split(sep);
    if (parts.length < 3) return '';
    let year = parts[2];
    if (year.length === 2) year = (parseInt(year) < 50 ? '20' : '19') + year;
    return `${parts[0].padStart(2,'0')}${parts[1].padStart(2,'0')}${year}`;
  }

  // Busca o bloco de versionamento que corresponde ao nome e/ou data digitados pelo usuário
  // Se ambos fornecidos: exige que o bloco passe nas DUAS condições (AND)
  // Se só nome: busca por keywords no conteúdo do bloco
  // Se só data: busca pelo bloco cuja data corresponde exatamente
  function findVersionEntry(pages, projectName, projectDate) {
    const hasName = !!projectName;
    const hasDate = !!projectDate;
    if (!hasName && !hasDate) return null;
    if (!pages.length) return null;

    const normalize  = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const keywords   = hasName ? extractKeywords(projectName) : [];
    const normTarget = hasDate ? normDate(projectDate) : '';
    const dateLineRe = /(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})\s+([^\n\r]{3,200})/g;
    const pageRefRe  = /p[áa]g(?:ina)?\.?\s*\d+\s*[-–—]/i;

    let bestMatch = null;
    let bestScore = 0;

    for (const page of pages.slice(-4).reverse()) {
      const text = page.text;
      const entries = [];
      let m;
      dateLineRe.lastIndex = 0;

      while ((m = dateLineRe.exec(text)) !== null) {
        const sep   = m[1].includes('/') ? '/' : '-';
        const parts = m[1].split(sep);
        let year    = parseInt(parts[2]);
        if (year < 100) year += 2000;
        const date  = new Date(year, parseInt(parts[1]) - 1, parseInt(parts[0]));
        if (!isNaN(date)) {
          entries.push({ date, dateStr: m[1], description: m[2].trim(), index: m.index, pageNum: page.page });
        }
      }

      for (let i = 0; i < entries.length; i++) {
        const entry     = entries[i];
        const endIndex  = i + 1 < entries.length ? entries[i + 1].index : text.length;
        const blockText = text.slice(entry.index, endIndex).trim();

        // Validação da data: se informada, deve corresponder exatamente
        if (hasDate && normDate(entry.dateStr) !== normTarget) continue;

        // Validação do nome: se informado, exige ao menos metade das keywords no bloco
        let score = 0;
        if (hasName && keywords.length > 0) {
          const normBlock = normalize(blockText);
          score = keywords.filter(kw => normBlock.includes(kw)).length;
          if (score < Math.ceil(keywords.length * 0.5)) continue;
        } else {
          score = 1; // só data fornecida — qualquer bloco que passou na data já é candidato
        }

        // Bloco deve ter referências de página (é um bloco de projeto, não uma nota)
        if (!pageRefRe.test(blockText)) continue;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            date:        entry.date,
            dateStr:     entry.dateStr,
            description: entry.description,
            blockText:   text.slice(entry.index).trim(),
            pageNum:     entry.pageNum,
          };
        }
      }

      if (bestMatch) break;
    }

    return bestMatch;
  }

  // ── Detecta o último bloco da tabela de versionamento ───────────────────
  // Estratégia: lê a ÚLTIMA página do documento e pega o ÚLTIMO bloco por posição
  // (último registro na tabela = projeto mais recente sendo implantado).
  // Fallback: tenta as 2 páginas anteriores se a última não tiver datas.
  function detectLatestVersionEntry(pages) {
    if (!pages.length) return null;

    const dateLineRe = /(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})\s+([^\n\r]{3,200})/g;

    // Examina da última página para a antepenúltima
    const candidates = pages.slice(-4).reverse(); // última primeiro

    for (const page of candidates) {
      const text = page.text;
      const entries = [];
      let m;

      while ((m = dateLineRe.exec(text)) !== null) {
        const sep = m[1].includes('/') ? '/' : '-';
        const parts = m[1].split(sep);
        let year = parseInt(parts[2]);
        if (year < 100) year += 2000;
        const date = new Date(year, parseInt(parts[1]) - 1, parseInt(parts[0]));
        if (!isNaN(date)) {
          entries.push({
            date,
            dateStr: m[1],
            description: m[2].trim(),
            index: m.index,   // posição no texto da página
            pageNum: page.page,
          });
        }
      }

      if (!entries.length) continue;

      // Preferencialmente, usa a última entrada que tenha referências de página
      // no seu bloco (ex: "Página 58 – Nova página...").
      // Entradas sem páginas listadas são provavelmente notas/correções menores.
      const pageRefRe = /p[áa]g(?:ina)?\.?\s*\d+\s*[-–—:]/i;

      let chosen = null;
      for (let i = entries.length - 1; i >= 0; i--) {
        const blockCandidate = text.slice(entries[i].index);
        if (pageRefRe.test(blockCandidate)) {
          chosen = entries[i];
          break;
        }
      }
      // Fallback: se nenhuma entrada tiver páginas listadas, usa a última por posição
      if (!chosen) chosen = entries[entries.length - 1];

      const blockText = text.slice(chosen.index).trim();

      return {
        date:        chosen.date,
        dateStr:     chosen.dateStr,
        description: chosen.description,
        blockText,
        pageNum:     chosen.pageNum,
      };
    }

    return null;
  }

  // ── Filtra e estrutura o texto do PDF em seções rotuladas ───────────────
  // Estratégia: versionamento → identifica projeto → busca páginas referenciadas
  // + páginas que mencionam o projeto no documento.
  // Budget (chars): VERSION 2 000 + FOCUS 7 500 ≈ ~8 500 tokens de contexto (free tier: 12 000 TPM)
  const BUDGET_VERSION = 2000;
  const BUDGET_FOCUS   = 7500;
  const BUDGET_FULL    = 16000;

  // Stopwords para extração de keywords do versionamento
  const STOPWORDS = new Set([
    'para','que','com','dos','das','uma','uns','umas','nos','nas','pelo','pela',
    'pelos','pelas','este','esta','estes','estas','isso','aqui','mais','como',
    'onde','quando','quem','qual','quais','seu','sua','seus','suas','todo','toda',
    'todos','todas','esse','essa','esses','essas','minha','nosso','nossa','foque',
    'liste','apenas','somente','sobre','quero','preciso','analise','verificar',
    'mostrar','leia','leitura','fazer','seja','resumo','resumir','gerar','criar',
    'documento','documentacao','novo','nova','novos','novas','mudanca','alteracao',
    'versao','parte','inclusao','criacao','atualizacao','ajuste','ajustes','fluxo',
    'fluxos','alterado','adicionado','removido','modificado','correcao',
  ]);

  // Extrai palavras-chave significativas de um texto (normalizado, sem stopwords)
  function extractKeywords(text) {
    const normalize = s => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return normalize(text)
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w));
  }

  // Extrai números de página de um texto via padrão "página N" / "pág. N" / "p. N"
  function extractPageRefs(text) {
    const matches = [...text.matchAll(/p[áa]g(?:ina)?\.?\s*(\d+)/gi)];
    return [...new Set(matches.map(m => parseInt(m[1])))].filter(n => n > 0 && n <= importedPages.length);
  }

  // Analisa "Página N – descrição" no bloco do versionamento
  // Retorna [{ page, description, keywords }] para cada página citada
  function parseVersionedPageRefs(blockText) {
    const re = /p[áa]g(?:ina)?\.?\s*(\d+)\s*[-–—:]\s*([^\n\r]{3,200})/gi;
    const refs = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(blockText)) !== null) {
      const page = parseInt(m[1]);
      const description = m[2].trim();
      if (!isNaN(page) && page > 0 && page <= importedPages.length && !seen.has(page)) {
        seen.add(page);
        refs.push({ page, description, keywords: extractKeywords(description) });
      }
    }
    return refs.sort((a, b) => a.page - b.page);
  }

  // Extrai o trecho mais relevante de uma página com base nas keywords da descrição
  // Desliza uma janela pelo texto e retorna o ponto com maior densidade de keywords
  function extractRelevantSnippet(pageText, keywords, maxLen) {
    if (!pageText) return '';
    if (!keywords.length) return pageText.slice(0, maxLen);

    const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normText = normalize(pageText);
    const step = 30;

    let bestPos = 0;
    let bestScore = -1;

    for (let i = 0; i < normText.length; i += step) {
      const slice = normText.slice(i, i + maxLen);
      const score = keywords.reduce((acc, kw) => acc + (slice.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestPos = i;
      }
    }

    // Recua levemente para incluir contexto antes do melhor ponto
    const start = Math.max(0, bestPos - 40);
    const end   = Math.min(pageText.length, start + maxLen);
    return pageText.slice(start, end).trim();
  }

  function filterTextByInstructions(instructions, fullMode = false, projectName = '', projectDate = '') {
    // ── Detecta versionamento ─────────────────────────────────────────────────
    // Se nome e/ou data foram informados, usa como critério de busca (AND quando ambos presentes)
    // Fallback: último bloco com refs de página
    detectedVersion = (projectName || projectDate)
      ? (findVersionEntry(importedPages, projectName, projectDate) || detectLatestVersionEntry(importedPages))
      : detectLatestVersionEntry(importedPages);

    // ── Modo Completo: enviar todo o documento sem filtragem ─────────────────
    if (fullMode) {
      let fullText = importedPages
        .map(p => `--- PÁGINA ${p.page} ---\n${p.text}`)
        .join('\n\n');
      if (fullText.length > BUDGET_FULL) {
        fullText = fullText.slice(0, BUDGET_FULL)
          + '\n\n[... documento truncado — use instruções específicas para as páginas relevantes ...]';
      }
      return `╔══ DOCUMENTO COMPLETO (${importedPages.length} páginas — modo sem filtro) ══╗\n${fullText}`;
    }

    // ── Seção 1: Versionamento (últimas 5 páginas) — âncora da análise ───────
    const versionPages = importedPages.slice(-5);
    const usedPageNums = new Set(versionPages.map(p => p.page));
    let versionSection = versionPages
      .map(p => `--- PÁGINA ${p.page} ---\n${p.text}`)
      .join('\n\n');
    if (versionSection.length > BUDGET_VERSION) {
      versionSection = versionSection.slice(0, BUDGET_VERSION) + '\n[... truncado ...]';
    }

    // ── Seção 2: Páginas do projeto ───────────────────────────────────────────
    // Estratégia:
    //   AUTO (sem instruções + versão detectada):
    //     1. parseVersionedPageRefs → snippet por keyword por página citada
    //     2. Fallback: busca por keywords nas demais páginas
    //   USER (com instruções): extractPageRefs + keywords → páginas completas
    //   Fallback final: amostra distribuída

    let focusSection = '';
    let focusLabel   = 'CONTEÚDO DO PROJETO';
    const otherPages = importedPages.filter(p => !usedPageNums.has(p.page));

    if (!instructions && detectedVersion) {
      // ── Caminho AUTO: extrai "Página N – descrição" do bloco do versionamento ─
      const versionedRefs = parseVersionedPageRefs(detectedVersion.blockText || '');

      if (versionedRefs.length > 0) {
        // Budget dinâmico: divide o espaço disponível igualmente entre todas as refs
        const snippetLen = Math.max(150, Math.min(400, Math.floor(BUDGET_FOCUS / versionedRefs.length)));

        let buf = '';
        for (const ref of versionedRefs) {
          const pageObj = importedPages.find(p => p.page === ref.page);
          if (!pageObj) continue;
          const snippet = extractRelevantSnippet(pageObj.text, ref.keywords, snippetLen);
          if (!snippet) continue;
          const header = `--- PÁGINA ${ref.page} [${ref.description.slice(0, 70)}] ---`;
          buf += `${header}\n${snippet}\n\n`;
        }
        focusSection = buf.trim();
        const pageList = versionedRefs.map(r => r.page).join(', ');
        focusLabel = `PÁGINAS CITADAS NO VERSIONAMENTO — ${versionedRefs.length} página${versionedRefs.length > 1 ? 's' : ''} (p. ${pageList})`;

      } else {
        // Sem refs estruturadas: busca por keywords do projeto nas demais páginas
        const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const keywords  = extractKeywords(detectedVersion.blockText || detectedVersion.description);
        if (keywords.length > 0) {
          const matched = otherPages
            .filter(p => keywords.some(kw => normalize(p.text).includes(kw)))
            .sort((a, b) => {
              const sA = keywords.filter(kw => normalize(a.text).includes(kw)).length;
              const sB = keywords.filter(kw => normalize(b.text).includes(kw)).length;
              return sB - sA;
            });
          let buf = '';
          for (const p of matched) {
            const block = `--- PÁGINA ${p.page} ---\n${p.text}`;
            if (buf.length + block.length + 2 > BUDGET_FOCUS) break;
            buf += block + '\n\n';
          }
          focusSection = buf.trim();
          focusLabel = 'PÁGINAS DO PROJETO (busca por keywords — refs não encontradas no versionamento)';
        }
      }

    } else if (instructions) {
      // ── Caminho USER: refs de página e keywords das instruções ───────────────
      const versionFullText  = versionPages.map(p => p.text).join('\n');
      const refSourceText    = instructions + '\n' + versionFullText;
      const explicitPageNums = extractPageRefs(refSourceText);
      const explicitPages    = explicitPageNums.length > 0
        ? otherPages.filter(p => explicitPageNums.includes(p.page))
        : [];

      const normalize   = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const keywords    = extractKeywords(instructions);
      const explicitSet = new Set(explicitPages.map(p => p.page));
      let keywordPages  = [];
      if (keywords.length > 0) {
        keywordPages = otherPages
          .filter(p => !explicitSet.has(p.page) && keywords.some(kw => normalize(p.text).includes(kw)))
          .sort((a, b) => {
            const sA = keywords.filter(kw => normalize(a.text).includes(kw)).length;
            const sB = keywords.filter(kw => normalize(b.text).includes(kw)).length;
            return sB - sA;
          });
      }

      const combined = [...explicitPages, ...keywordPages].sort((a, b) => a.page - b.page);
      if (combined.length > 0) {
        let buf = '';
        for (const p of combined) {
          const block = `--- PÁGINA ${p.page} ---\n${p.text}`;
          if (buf.length + block.length + 2 > BUDGET_FOCUS) break;
          buf += block + '\n\n';
        }
        focusSection = buf.trim();
        if (explicitPages.length > 0 && keywordPages.length > 0) {
          focusLabel = `PÁGINAS DO PROJETO — refs: p. ${explicitPages.map(p=>p.page).join(', ')} | relacionadas: p. ${keywordPages.slice(0,5).map(p=>p.page).join(', ')}`;
        } else if (explicitPages.length > 0) {
          focusLabel = `PÁGINAS REFERENCIADAS (p. ${explicitPages.map(p=>p.page).join(', ')})`;
        } else {
          focusLabel = 'PÁGINAS DO PROJETO (busca por keywords das instruções)';
        }
      }
    }

    // ── Fallback final: amostra distribuída ──────────────────────────────────
    if (!focusSection) {
      const n = otherPages.length;
      if (n > 0) {
        const firstChunk = otherPages.slice(0, Math.ceil(n * 0.3));
        const midChunk   = otherPages.slice(Math.ceil(n * 0.3), Math.ceil(n * 0.7));
        const lastChunk  = otherPages.slice(Math.ceil(n * 0.7));
        const interleaved = [];
        const maxLen = Math.max(firstChunk.length, midChunk.length, lastChunk.length);
        for (let i = 0; i < maxLen; i++) {
          if (firstChunk[i]) interleaved.push(firstChunk[i]);
          if (midChunk[i])   interleaved.push(midChunk[i]);
          if (lastChunk[i])  interleaved.push(lastChunk[i]);
        }
        let buf = '';
        for (const p of interleaved) {
          const block = `--- PÁGINA ${p.page} ---\n${p.text}`;
          if (buf.length + block.length + 2 > BUDGET_FOCUS) break;
          buf += block + '\n\n';
        }
        focusSection = buf.trim();
        focusLabel = instructions
          ? 'AMOSTRA AUTOMÁTICA (projeto não localizado — cobertura distribuída)'
          : 'AMOSTRA DISTRIBUÍDA (versão não detectada — início + meio + fim)';
      }
    }

    if (focusSection.length > BUDGET_FOCUS) {
      focusSection = focusSection.slice(0, BUDGET_FOCUS) + '\n[... truncado ...]';
    }

    // ── Monta texto estruturado com seções rotuladas ──────────────────────────
    const parts = [`╔══ SEÇÃO 1 — VERSIONAMENTO ══╗\n${versionSection}`];
    if (focusSection) {
      parts.push(`╔══ SEÇÃO 2 — ${focusLabel} ══╗\n${focusSection}`);
    }
    return parts.join('\n\n');
  }

  // ── Prompt ────────────────────────────────────────────────────────────────
  function buildPrompt(hldText, projectName, version, userInstructions) {
    const proj = projectName || 'sem nome';
    const ver  = version || 'V1';

    // Bloco de foco: instruções do usuário têm prioridade máxima
    let focusBlock = '';
    if (userInstructions) {
      focusBlock = `\n## FOCO DA ANÁLISE (instrução do analista):\n${userInstructions}\n\n**Analise SOMENTE o projeto/conteúdo indicado acima.** Ignore outros projetos que possam aparecer no documento.\n`;
    } else if (detectedVersion) {
      const rawBlock = detectedVersion.blockText || detectedVersion.description;
      const block = rawBlock.length > 500 ? rawBlock.slice(0, 500) + '...' : rawBlock;

      focusBlock = `\n## FOCO DA ANÁLISE — ÚLTIMO BLOCO DA TABELA DE VERSIONAMENTO (p. ${detectedVersion.pageNum}):\n\`\`\`\n${block}\n\`\`\`\n\nEste é o último registro da tabela de versionamento — o projeto mais recente sendo implantado.\n- A **data da alteração** está neste bloco (formato DD/MM/AA ou DD/MM/AAAA).\n- O **nome do projeto** é o termo em destaque neste bloco (ex: após as siglas do autor: "JVL Propensão BACEN ...").\n- NUNCA escreva "Não especificado no HLD" para o nome — ele está no bloco acima.\n\n**Analise SOMENTE este projeto.**\n`;
    }

    return `Você é um Product Owner experiente em sistemas de URA (Unidade de Resposta Audível) para contact centers bancários. Sua função é ler documentos HLD técnicos e transformá-los em uma documentação de produto clara, acessível para todo o squad — UX, Desenvolvimento, BI e QA — sem exigir conhecimento técnico prévio do HLD.

## Projeto: ${proj}
## Versão: ${ver}
${focusBlock}
---
### DOCUMENTO HLD (extraído do PDF, dividido em seções):
${hldText}

---

## REGRAS OBRIGATÓRIAS DE ANÁLISE

1. **SEÇÃO 1 — VERSIONAMENTO** é a âncora. Leia-a primeiro e identifique exatamente qual projeto/alteração está sendo implantado nesta versão e em qual data.
2. **SEÇÃO 2** contém as páginas do HLD referentes a esse projeto. Use-a para detalhar o que está descrito no versionamento.
3. **Foco exclusivo**: documente APENAS o projeto identificado no foco da análise. Se houver outros projetos no documento, ignore-os completamente.
4. **Sem invenção**: se uma informação não estiver explícita no texto fornecido, escreva "Não especificado no HLD". Nunca extrapole ou assuma.

---

## ESTRUTURA DO DOCUMENTO A GERAR

### 1. VISÃO GERAL DO PROJETO
Comece com duas linhas em destaque (negrito), extraídas diretamente do versionamento:
- **Projeto:** [nome exato do projeto conforme consta no versionamento]
- **Data da alteração:** [data exata conforme consta no versionamento]

Em seguida, escreva 2-3 parágrafos explicando: o que está sendo implantado, qual problema de negócio resolve e quem são os usuários impactados.

### 2. JORNADA DO USUÁRIO / FLUXOS
Descreva como o usuário experimenta a mudança dentro da URA. Use linguagem narrativa que qualquer membro do squad — UX, DEV, BI ou QA — consiga visualizar sem precisar abrir o HLD.

### 3. IMPACTO POR DISCIPLINA
Destaque o que cada área do squad precisa saber:
- **UX**: mudanças de fluxo, novos estados, mensagens de áudio alteradas
- **Desenvolvimento**: integrações novas ou modificadas, lógica de negócio
- **BI**: novos eventos de marcação, tags, pontos de dados gerados
- **QA**: cenários críticos a validar, fluxos de regressão, comportamentos de erro

---

Use formatação Markdown com listas e hierarquia. Escreva em linguagem de produto — clara, direta, sem siglas não explicadas.

**IMPORTANTE — citação de páginas:** O documento foi fornecido com marcadores \`--- PÁGINA N ---\`. Sempre que mencionar uma funcionalidade, fluxo ou integração, cite a página de origem no formato **(p. N)**. Se vier de múltiplas páginas: **(p. 5, 12)**.`;
  }

  // ── Extrai números de páginas presentes no texto filtrado ────────────────
  function extractPageNumbers(text) {
    const nums = [];
    const re = /---\s*P[ÁA]GINA\s+(\d+)[^\n]*---/gi;
    let m;
    while ((m = re.exec(text)) !== null) nums.push(parseInt(m[1], 10));
    return [...new Set(nums)].sort((a, b) => a - b);
  }

  // Formata lista de números em intervalos legíveis: [1,2,3,5,6,10] → "1–3, 5–6, 10"
  function formatPageRanges(nums) {
    if (!nums.length) return '';
    const ranges = [];
    let start = nums[0], end = nums[0];
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === end + 1) {
        end = nums[i];
      } else {
        ranges.push(start === end ? `${start}` : `${start}–${end}`);
        start = end = nums[i];
      }
    }
    ranges.push(start === end ? `${start}` : `${start}–${end}`);
    return ranges.join(', ');
  }

  function renderPagesBadge(filteredText) {
    const badge = $('pages-badge');
    const nums  = extractPageNumbers(filteredText);
    if (!nums.length) { badge.style.display = 'none'; return; }
    const total  = nums.length;
    const ranges = formatPageRanges(nums);
    const chars  = filteredText.length.toLocaleString('pt-BR');
    const pct    = importedPages.length > 0
      ? Math.round((total / importedPages.length) * 100)
      : 0;
    $('pages-badge-text').innerHTML =
      `<strong>${total} página${total > 1 ? 's' : ''}</strong> analisadas (${pct}% do total): ${ranges}`
      + ` &nbsp;·&nbsp; <strong>${chars}</strong> chars enviados ao modelo`
      + ` &nbsp;·&nbsp; As citações <strong>(p. N)</strong> no texto indicam a página de origem.`;
    badge.style.display = 'flex';
  }

  // ── Streaming call (Groq) ────────────────────────────────────────────────
  async function callGroqStream(prompt, apiKey, model = GROQ_MODEL_TECH, maxTokens = 6000) {
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.4,
      stream: true,
    };

    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${response.status}`;
      throw new Error(msg);
    }

    return response.body.getReader();
  }

  // ── Leitor de SSE stream → chama onChunk(string) para cada token ─────────
  async function readStream(reader, onChunk) {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(data); } catch { continue; }
        const chunk = evt?.choices?.[0]?.delta?.content;
        if (chunk) onChunk(chunk);
      }
    }
  }

  // ── Render markdown-like output ───────────────────────────────────────────
  function renderMarkdown(text) {
    let sectionIndex = 0;

    let out = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    out = out.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
      `<pre><code>${code.trimEnd()}</code></pre>`
    );

    out = out.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    out = out.replace(/^### (.+)$/gm,  '<h3>$1</h3>');
    out = out.replace(/^## (.+)$/gm, (_, title) => {
      sectionIndex++;
      return `<h2 data-n="${sectionIndex}">${title}</h2>`;
    });
    out = out.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
    out = out.replace(/\*(.+?)\*/g,         '<em>$1</em>');
    out = out.replace(/_(.+?)_/g,           '<em>$1</em>');

    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

    out = out.replace(/\bNOVO\b/g,        '<span class="bc bc-novo">NOVO</span>');
    out = out.replace(/\bMODIFICADO\b/g,  '<span class="bc bc-mod">MODIFICADO</span>');
    out = out.replace(/\bREMOVIDO\b/g,    '<span class="bc bc-rem">REMOVIDO</span>');
    out = out.replace(/\bSEM MUDANÇA\b/g, '<span class="bc bc-sem">SEM MUDANÇA</span>');

    out = out.replace(/\bAlto\b/g,  '<span class="bi bi-alto">Alto</span>');
    out = out.replace(/\bMédio\b/g, '<span class="bi bi-medio">Médio</span>');
    out = out.replace(/\bBaixo\b/g, '<span class="bi bi-baixo">Baixo</span>');

    out = out.replace(/^---$/gm, '<hr>');

    out = out.replace(/^\d+\. (.+)$/gm, '<li data-ol>$1</li>');
    out = out.replace(/((?:<li data-ol>.+<\/li>\n?)+)/g, group =>
      '<ol>' + group.replace(/ data-ol/g, '') + '</ol>'
    );

    out = out.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
    out = out.replace(/((?:<li>.+<\/li>\n?)+)/g, group => `<ul>${group}</ul>`);

    out = out.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    const blockTags = /^<\/?(?:h[1-6]|ul|ol|li|hr|pre|blockquote)/;
    const lines = out.split('\n');
    const parts = [];
    let buf = [];

    const flushBuf = () => {
      if (!buf.length) return;
      const joined = buf.join('<br>').trim();
      if (joined) parts.push(`<p>${joined}</p>`);
      buf = [];
    };

    for (const line of lines) {
      if (line === '') {
        flushBuf();
      } else if (blockTags.test(line.trim())) {
        flushBuf();
        parts.push(line);
      } else {
        buf.push(line);
      }
    }
    flushBuf();

    return parts.join('\n');
  }

  // ── Main generate — Product Owner (fase única) ───────────────────────────
  async function runGenerate() {
    if (isStreaming) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      showToast('Informe a chave da API Groq (gsk_...).', 'error');
      $('api-key-input').focus();
      return;
    }
    if (!importedText) {
      showToast('Importe um arquivo PDF antes de gerar a documentação.', 'warning');
      return;
    }

    const projectName      = $('config-project-name').value.trim();
    const projectDate      = $('config-version').value.trim();
    const userInstructions = $('user-instructions').value.trim();

    isStreaming = true;
    currentResult = '';
    $('btn-generate').disabled = true;
    $('btn-generate').textContent = 'Analisando...';
    $('progress-status').style.display = 'flex';
    $('result-area').style.display = 'none';
    $('result-output').innerHTML = '';
    $('result-output').style.display = '';
    $('result-edit').style.display = 'none';
    const btnEdit = $('btn-edit-toggle');
    btnEdit.classList.remove('editing');
    btnEdit.textContent = '✎ Editar';

    try {
      $('progress-text').textContent = 'Filtrando conteúdo relevante do PDF...';

      const fullMode = $('full-mode-toggle') && $('full-mode-toggle').checked;
      const filteredText = filterTextByInstructions(userInstructions, fullMode, projectName, projectDate);
      renderPagesBadge(filteredText);

      if (fullMode) {
        $('progress-text').textContent = `Modo Completo: ${importedPages.length} páginas enviadas ao modelo...`;
        await new Promise(r => setTimeout(r, 500));
      } else if (!userInstructions && detectedVersion) {
        $('progress-text').textContent =
          `Último bloco detectado (p. ${detectedVersion.pageNum}): ${detectedVersion.dateStr} — ${detectedVersion.description.slice(0, 55)}...`;
        await new Promise(r => setTimeout(r, 900));
      } else if (!userInstructions && !detectedVersion) {
        $('progress-text').textContent = 'Nenhuma versão detectada — usando amostra distribuída do documento...';
        await new Promise(r => setTimeout(r, 600));
      }

      $('progress-text').textContent = 'Gerando documentação Product Owner...';
      $('result-area').style.display = 'block';
      $('result-output').classList.add('streaming');

      const reader = await callGroqStream(
        buildPrompt(filteredText, projectName, projectDate, userInstructions),
        apiKey,
        GROQ_MODEL_TECH
      );

      await readStream(reader, chunk => {
        currentResult += chunk;
        $('result-output').innerHTML = renderMarkdown(currentResult)
          + '<span class="stream-cursor"></span>';
      });
      $('result-output').innerHTML = renderMarkdown(currentResult);
      $('result-output').classList.remove('streaming');

      showToast('Documentação gerada com sucesso!', 'success');

    } catch (err) {
      showToast(`Erro: ${err.message}`, 'error');
      console.error('[HLDCompare] Groq error:', err);
    } finally {
      isStreaming = false;
      $('btn-generate').disabled = false;
      $('btn-generate').textContent = '✦ Gerar Documentação';
      $('progress-status').style.display = 'none';
    }
  }

  // ── Export PDF ───────────────────────────────────────────────────────────
  function exportDoc() {
    const exportResult = currentResult;
    if (!exportResult) { showToast('Nenhuma documentação gerada ainda.', 'warning'); return; }

    const projectName = $('config-project-name').value.trim() || 'HLD';
    const version     = $('config-version').value.trim() || 'V1';
    const now = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const bodyHtml = renderMarkdown(exportResult);

    const tocItems = [];
    const h2Re = /<h2 data-n="(\d+)">([^<]+)<\/h2>/g;
    let h2m;
    while ((h2m = h2Re.exec(bodyHtml)) !== null) {
      tocItems.push(`<li><span class="toc-num">${h2m[1]}.</span><span class="toc-title">${h2m[2]}</span></li>`);
    }
    const tocHtml = tocItems.length
      ? `<nav class="toc"><div class="toc-heading">Índice</div><ol>${tocItems.join('')}</ol></nav>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>HLD — ${escHtml(projectName)} ${escHtml(version)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; line-height: 1.8;
      color: #1a1d23; background: #dde3ec; padding: 40px 16px 60px;
    }
    .doc-wrap { max-width: 870px; margin: 0 auto; background: #fff; border-radius: 6px; box-shadow: 0 6px 28px rgba(0,0,0,.18); overflow: hidden; }

    .doc-cover {
      background: #002775; color: #fff; padding: 52px 56px 44px; border-bottom: 5px solid #0051c8;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .doc-cover .eyebrow { font-size: .68rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.55); margin-bottom: 18px; }
    .doc-cover h1 { font-size: 1.65rem; font-weight: 700; line-height: 1.25; margin-bottom: 8px; color: #fff; }
    .doc-cover .subtitle { font-size: .85rem; color: rgba(255,255,255,.72); margin-bottom: 32px; }
    .ver-pill {
      display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; border-radius: 4px;
      font-size: .82rem; font-weight: 700; background: #0051c8; color: #fff; margin-bottom: 28px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .ver-pill .lbl { font-weight: 400; opacity: .75; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; }
    .meta-row { display: flex; gap: 24px; flex-wrap: wrap; border-top: 1px solid rgba(255,255,255,.15); padding-top: 18px; }
    .meta-item { font-size: .72rem; color: rgba(255,255,255,.55); }
    .meta-item strong { color: rgba(255,255,255,.85); font-weight: 600; display: block; margin-bottom: 2px; }

    .toc { background: #f5f7fb; border-bottom: 1px solid #dde3f0; padding: 28px 56px 26px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .toc-heading { font-size: .65rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #8a93a6; margin-bottom: 14px; }
    .toc ol { list-style: none; columns: 2; column-gap: 32px; }
    .toc li { display: flex; align-items: baseline; gap: 8px; padding: 4px 0; font-size: .825rem; break-inside: avoid; }
    .toc-num { font-weight: 700; color: #0051c8; min-width: 18px; flex-shrink: 0; }
    .toc-title { color: #2c3a5a; }

    .doc-body { padding: 40px 56px 48px; line-height: 1.8; }
    .doc-body h2[data-n] {
      margin: 2.6em 0 .8em; padding: 10px 16px 10px 20px; background: #f0f4fb;
      border-left: 4px solid #0051c8; border-radius: 0 4px 4px 0; font-size: 1rem; font-weight: 700;
      color: #002775; page-break-after: avoid; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .doc-body h2[data-n]::before { content: attr(data-n) "."; display: inline-block; margin-right: 8px; color: #0051c8; font-weight: 700; font-size: .9em; }
    .doc-body h3 { font-size: .9rem; font-weight: 700; color: #1a3a6b; margin: 1.6em 0 .5em; page-break-after: avoid; }
    .doc-body p { margin: .6em 0; }
    .doc-body strong { color: #0d1f42; }
    .doc-body hr { border: none; border-top: 1px solid #e4e8f2; margin: 1.6em 0; }
    .doc-body ul { margin: .5em 0 .9em; padding-left: 1.5em; }
    .doc-body li { margin: .3em 0; }
    .doc-body li::marker { color: #0051c8; }
    .doc-body code { background: #f0f4fb; border: 1px solid #d4daea; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: .82em; }
    .doc-body blockquote { border-left: 3px solid #0051c8; margin: .8em 0; padding: 6px 14px; background: #f5f7fb; color: #3a4a6b; font-style: italic; }

    .bc { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: .68rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; vertical-align: middle; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .bc-novo { background: #d6f0de; color: #1a6632; }
    .bc-mod  { background: #fff0d6; color: #7a4800; }
    .bc-rem  { background: #fde4e4; color: #9b1c1c; }
    .bc-sem  { background: #edf0f5; color: #5a6478; }
    .bi { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: .68rem; font-weight: 700; letter-spacing: .03em; vertical-align: middle; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .bi-alto  { background: #fde4e4; color: #9b1c1c; }
    .bi-medio { background: #fff0d6; color: #7a4800; }
    .bi-baixo { background: #d6f0de; color: #1a6632; }

    .doc-footer { background: #f5f7fb; border-top: 1px solid #dde3f0; padding: 14px 56px; display: flex; justify-content: space-between; align-items: center; font-size: .7rem; color: #8a93a6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .doc-footer .footer-brand { font-weight: 600; color: #5a6680; }

    @media print {
      @page { size: A4 portrait; margin: 18mm 16mm 22mm; }
      body { background: #fff; padding: 0; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .doc-wrap { box-shadow: none; border-radius: 0; max-width: 100%; }
      .doc-cover { padding: 36px 40px 30px; }
      .toc { padding: 20px 40px 18px; }
      .doc-body { padding: 28px 40px 36px; }
      .doc-footer { padding: 10px 40px; }
      .doc-body h2, .doc-body h3 { page-break-after: avoid; }
      .doc-body h2 + p, .doc-body h2 + ul, .doc-body h3 + p, .doc-body h3 + ul { page-break-before: avoid; }
      li, p { page-break-inside: avoid; }
      .toc ol { columns: 1; }
    }
  </style>
</head>
<body>
  <div class="doc-wrap">
    <div class="doc-cover">
      <div class="eyebrow">QA Dashboard &mdash; Leitor de HLD</div>
      <h1>${escHtml(projectName)}</h1>
      <div class="subtitle">Análise de novidades e documentação gerada por IA</div>
      <div><span class="ver-pill"><span class="lbl">Versão</span>${escHtml(version)}</span></div>
      <div class="meta-row">
        <div class="meta-item"><strong>Projeto</strong>${escHtml(projectName)}</div>
        <div class="meta-item"><strong>Versão do HLD</strong>${escHtml(version)}</div>
        <div class="meta-item"><strong>Gerado em</strong>${now}</div>
        <div class="meta-item"><strong>Modelo</strong>${GROQ_MODEL_TECH}</div>
      </div>
    </div>
    ${tocHtml}
    <div class="doc-body">${bodyHtml}</div>
    <div class="doc-footer">
      <span class="footer-brand">QA Dashboard &mdash; Leitor de HLD</span>
      <span>Powered by Groq &middot; ${GROQ_MODEL_TECH}</span>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 600); });
  <\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (!win) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `hld-${projectName.replace(/\s+/g, '-')}-${version}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('Pop-up bloqueado. Arquivo baixado — abra e use Ctrl+P para salvar como PDF.', 'warning');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ── Copy text ─────────────────────────────────────────────────────────────
  async function copyText() {
    if (!currentResult) { showToast('Nenhuma documentação gerada ainda.', 'warning'); return; }
    try {
      await navigator.clipboard.writeText(currentResult);
      showToast('Texto copiado para a área de transferência.', 'success');
    } catch {
      showToast('Não foi possível copiar. Selecione e copie manualmente.', 'warning');
    }
  }

  // ── Clear all ─────────────────────────────────────────────────────────────
  function resetImport() {
    importedText     = '';
    importedPages    = [];
    detectedVersion  = null;
    $('file-input').value = '';
    $('pdf-dropzone').style.display = '';
    $('pdf-loaded').classList.remove('visible');
    $('pdf-name').textContent = '—';
    $('pdf-meta').textContent = '—';
    $('btn-generate').disabled = true;
  }

  function clearAll() {
    resetImport();
    $('config-project-name').value = '';
    $('config-version').value = 'V1';
    currentResult = '';
    $('result-area').style.display = 'none';
    $('result-output').innerHTML = '';
    $('pages-badge').style.display = 'none';
    showToast('Campos limpos.', 'info');
  }

  // ── Edit mode toggle ──────────────────────────────────────────────────────
  function toggleEditMode() {
    const btn    = $('btn-edit-toggle');
    const view   = $('result-output');
    const editor = $('result-edit');
    const editing = btn.classList.contains('editing');

    if (!editing) {
      // Entrar no modo edição: mostra textarea com markdown bruto
      editor.value = currentResult;
      view.style.display   = 'none';
      editor.style.display = 'block';
      btn.classList.add('editing');
      btn.textContent = '✓ Visualizar';
    } else {
      // Sair do modo edição: salva e re-renderiza
      currentResult = editor.value;
      view.innerHTML       = renderMarkdown(currentResult);
      view.style.display   = '';
      editor.style.display = 'none';
      btn.classList.remove('editing');
      btn.textContent = '✎ Editar';
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.classList.add('toast-visible'), 10);
    setTimeout(() => {
      el.classList.remove('toast-visible');
      setTimeout(() => el.remove(), 400);
    }, 3500);
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    loadApiKey();

    // Pré-preenche "Nome do Projeto" se vier do Kanban via ?project=
    const urlParams  = new URLSearchParams(window.location.search);
    const urlProject = urlParams.get('project');
    const isPopup    = urlParams.get('popup') === '1';
    if (urlProject) $('config-project-name').value = urlProject;

    // Modo popup: substitui "Copiar texto" por "Usar no card"
    if (isPopup) {
      const btnCopy = $('btn-copy-text');
      btnCopy.textContent = '✓ Usar no card';
      btnCopy.title = 'Envia a descrição gerada para o card do Kanban e fecha esta janela';
      btnCopy.onclick = () => {
        if (window.opener) {
          window.opener.postMessage({ type: 'hld-result', text: currentResult }, '*');
        }
        window.close();
      };
    }

    $('btn-save-key').addEventListener('click', saveApiKey);
    $('btn-clear-key').addEventListener('click', clearApiKey);

    // File input via click
    $('file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) importPDF(file);
    });

    // Drag & drop on the drop zone
    const dz = $('pdf-dropzone');
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) importPDF(file);
    });

    $('btn-change-file').addEventListener('click', resetImport);

    $('btn-generate').addEventListener('click', runGenerate);
    $('btn-clear-all').addEventListener('click', clearAll);

    $('btn-export-doc').addEventListener('click', exportDoc);
    $('btn-copy-text').addEventListener('click', copyText);
    $('btn-edit-toggle').addEventListener('click', toggleEditMode);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { init };

})();
