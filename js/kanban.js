'use strict';

const Kanban = (() => {

  // ── State ─────────────────────────────────────────────────────────────────
  const DEFAULT_CHECKLIST = [
    'Aprovação do Escopo',
    'Desenho do Fluxo',
    'Aprovação do Fluxo',
    'Desenvolvimento',
    'Homologação',
    'Certificação',
    'Implantação',
  ];

  let currentEditingCardId  = null;
  let currentModalColumnId  = null;
  let selectedPriority      = 'normal';
  let selectedMemberIds     = [];
  let selectedTagIds        = [];
  let currentChecklist      = [];   // [{ id, text, done }]
  let confirmCallback       = null;
  let isNewCard             = false;
  let cardWasSaved          = false;
  let originalCardSnapshot  = null;
  let draggingChecklistId   = null;

  let filterMemberIds  = new Set();
  let filterTagIds     = new Set();
  let filterPriorities = new Set();
  let filterDeadline   = false;
  let filterSearch     = '';

  let draggingCardId   = null;
  let draggingColId    = null;
  let dragOverColId    = null;

  const $ = id => document.getElementById(id);

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _autoRegisterCurrentUser();
    renderBoard();
    bindGlobalEvents();
  }

  function _autoRegisterCurrentUser() {
    const me = Storage.getCurrentUser();
    if (!me) return;
    // Always upsert to keep photo and name up to date
    Storage.saveMember({
      id: me.id, name: me.name, initials: me.initials,
      color: me.color, photoUrl: me.photoUrl || null,
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderBoard() {
    const board = $('kanban-board');
    board.innerHTML = '';

    const columns = Storage.getColumns();
    columns.forEach(col => board.appendChild(renderColumn(col)));
    board.appendChild(buildAddColumnWidget());
    _updateDeadlineAlert();
  }

  function _updateDeadlineAlert() {
    const btn = $('btn-deadline-alert');
    if (!btn) return;

    const allCards = Storage.getAllCards();
    let overdue = 0, warning = 0;
    allCards.forEach(c => {
      if (!c.deadline) return;
      const days = Utils.getDaysUntilDeadline(c.deadline);
      if (days < 0)       overdue++;
      else if (days <= 3) warning++;
    });

    const total = overdue + warning;
    if (total === 0) {
      btn.style.display = 'none';
      return;
    }

    const parts = [];
    if (overdue > 0) parts.push(`${overdue} vencido${overdue > 1 ? 's' : ''}`);
    if (warning > 0) parts.push(`${warning} próximo${warning > 1 ? 's' : ''}`);

    btn.style.display = '';
    btn.innerHTML = `⚠ Deadline <span class="alert-badge">${total}</span>`;
    btn.title = parts.join(' · ');
  }

  function colAvatarColor(id) {
    const colors = ['#4CAF50','#2196F3','#FF9800','#9C27B0','#00BCD4','#E91E63','#607D8B'];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xfffffff;
    return colors[h % colors.length];
  }

  function renderColumn(col) {
    const allCards = Storage.getCards(col.id);
    const cards = allCards.filter(c => {
      const memberOk   = filterMemberIds.size  === 0 || (c.memberIds || []).some(id => filterMemberIds.has(id));
      const tagOk      = filterTagIds.size     === 0 || (c.tagIds    || []).some(id => filterTagIds.has(id));
      const priorityOk = filterPriorities.size === 0 || filterPriorities.has(c.priority || 'normal');
      const deadlineOk = !filterDeadline || (c.deadline && Utils.getDaysUntilDeadline(c.deadline) <= 3);
      const q = filterSearch.toLowerCase();
      const searchOk   = !q || (c.title || '').toLowerCase().includes(q);
      return memberOk && tagOk && priorityOk && deadlineOk && searchOk;
    });
    const el     = document.createElement('div');
    el.className = 'kanban-column';
    el.dataset.columnId = col.id;
    el.draggable = true;

    const avatarColor = colAvatarColor(col.id);
    const initial     = Utils.escHtml(col.title.charAt(0).toUpperCase());

    el.innerHTML = `
      <div class="column-header" data-col-header="${col.id}">
        <div class="col-avatar" style="background:${avatarColor}">${initial}</div>
        <span class="column-title" data-col-title="${col.id}">${Utils.escHtml(col.title)}</span>
        <div class="column-actions">
          <span class="column-count">${cards.length}</span>
          <button class="btn-icon" data-action="add-card" data-col="${col.id}" title="Adicionar card">+</button>
          <button class="btn-icon" data-action="delete-col" data-col="${col.id}" title="Excluir coluna">&#128465;</button>
        </div>
      </div>
      <div class="column-cards" data-drop-zone="${col.id}"></div>
      <button class="column-add-btn" data-action="add-card" data-col="${col.id}">+ Adicionar card</button>
    `;

    const dropZone = el.querySelector('.column-cards');
    cards.forEach(card => dropZone.appendChild(renderCard(card)));

    // Column drag events
    el.addEventListener('dragstart',  onColumnDragStart);
    el.addEventListener('dragend',    onColumnDragEnd);
    el.addEventListener('dragover',   onColumnDragOver);
    el.addEventListener('dragleave',  onColumnDragLeave);
    el.addEventListener('drop',       onColumnDrop);

    // Title double-click to rename
    el.querySelector(`[data-col-title="${col.id}"]`)
      .addEventListener('dblclick', () => startRenameColumn(col.id, el));

    return el;
  }

  function buildProgressCircle(done, total) {
    const r    = 16;
    const circ = 2 * Math.PI * r;
    if (total === 0) {
      return `<svg viewBox="0 0 40 40" width="40" height="40">
        <circle cx="20" cy="20" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="3"/>
        <line x1="14" y1="20" x2="26" y2="20" stroke="#c9cdd4" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    }
    const pct   = Math.round(done / total * 100);
    const color = pct === 100 ? '#28a745' : pct > 0 ? '#2196F3' : '#d1d5db';
    const dash  = (pct / 100) * circ;
    const label = pct === 100 ? '✓' : `${pct}%`;
    const fs    = pct === 100 ? '13' : pct < 10 ? '11' : '9';
    const dy    = pct === 100 ? '25' : '24';
    return `<svg viewBox="0 0 40 40" width="40" height="40">
      <circle cx="20" cy="20" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="3"/>
      <circle cx="20" cy="20" r="${r}" fill="none" stroke="${color}" stroke-width="3"
        stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}"
        stroke-linecap="round" transform="rotate(-90 20 20)"/>
      <text x="20" y="${dy}" text-anchor="middle" font-size="${fs}"
        fill="${color}" font-weight="700" font-family="inherit">${label}</text>
    </svg>`;
  }

  function renderCard(card) {
    const el = document.createElement('div');
    el.className = `kanban-card priority-${card.priority || 'normal'}`;
    el.dataset.cardId = card.id;
    el.draggable = true;

    const priorityLabels = { urgent: 'Urgente', normal: 'Normal', low: 'Baixa' };
    const priorityPills  = { urgent: 'pill-urgent', normal: 'pill-normal', low: 'pill-low' };
    const p = card.priority || 'normal';

    const deadlineHtml   = buildDeadlineHtml(card.deadline);
    const avatarsHtml    = buildAvatarsHtml(card.memberIds || []);
    const checklistHtml  = buildChecklistBadge(card.checklist || []);
    const tagsHtml       = buildCardTagsHtml(card.tagIds || []);
    const hasMeta        = card.deadline || (card.memberIds && card.memberIds.length > 0) || checklistHtml;

    if (card.deadline) {
      const days = Utils.getDaysUntilDeadline(card.deadline);
      if (days < 0)       el.classList.add('card-overdue');
      else if (days <= 3) el.classList.add('card-warning');
      else                el.classList.add('card-on-track');
    }

    const wasUpdated = card.updatedAt && card.createdAt && card.updatedAt !== card.createdAt;
    const tsHtml = card.createdAt ? `
      <div class="card-timestamps">
        <span class="card-ts-created">Criado ${Utils.formatDateTime(card.createdAt)}</span>
        ${wasUpdated ? `<span class="card-ts-updated">Editado ${Utils.formatDateTime(card.updatedAt)}</span>` : ''}
      </div>` : '';

    const checklist = card.checklist || [];
    const clTotal   = checklist.length;
    const clDone    = checklist.filter(i => i.done).length;

    const bottomRow = (tagsHtml || avatarsHtml) ? `
      <div class="card-bottom-row">
        ${tagsHtml}
        ${avatarsHtml ? `<div class="card-avatars card-avatars-end">${avatarsHtml}</div>` : ''}
      </div>` : '';

    el.innerHTML = `
      <div class="card-face">
        <div class="card-face-avatar">${buildProgressCircle(clDone, clTotal)}</div>
        <div class="card-face-body">
          <div class="card-top-row">
            <span class="card-priority-pill ${priorityPills[p]}">
              <span class="priority-dot dot-${p}"></span>${priorityLabels[p]}
            </span>
          </div>
          <div class="card-title">${highlightSearch(card.title)}</div>
          ${deadlineHtml ? `<div class="card-meta-row">${deadlineHtml}</div>` : ''}
        </div>
      </div>
      ${bottomRow}
    `;

    el.addEventListener('click',     () => openCardModal(card.columnId, card.id));
    el.addEventListener('dragstart', onCardDragStart);
    el.addEventListener('dragend',   onCardDragEnd);

    return el;
  }

  function highlightSearch(text) {
    if (!filterSearch) return Utils.escHtml(text);
    const escaped = Utils.escHtml(text);
    const q = filterSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(q, 'gi'), m => `<mark class="search-highlight">${m}</mark>`);
  }

  function buildDeadlineHtml(dateStr) {
    if (!dateStr) return '<span></span>';
    const days = Utils.getDaysUntilDeadline(dateStr);
    const fmt  = new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
    let cls = 'deadline-ok';
    if (days < 0)     cls = 'deadline-overdue';
    else if (days <= 3) cls = 'deadline-warning';
    const icon = days < 0 ? '&#128680;' : days <= 3 ? '&#9200;' : '&#128197;';
    return `<span class="card-deadline ${cls}">${icon} ${fmt}</span>`;
  }

  function buildAvatarsHtml(memberIds) {
    const members = Storage.getMembers();
    return memberIds
      .map(id => members.find(m => m.id === id))
      .filter(Boolean)
      .slice(0, 4)
      .map(m => {
        const inner = m.photoUrl
          ? `<img src="${m.photoUrl}" alt="${Utils.escHtml(m.initials)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`
          : Utils.escHtml(m.initials);
        const bg = m.photoUrl ? 'transparent' : m.color;
        return `<span class="avatar" style="background:${bg};overflow:hidden" title="${Utils.escHtml(m.name)}">${inner}</span>`;
      })
      .join('');
  }

  function buildChecklistBadge(checklist) {
    if (!checklist.length) return '';
    const done  = checklist.filter(i => i.done).length;
    const total = checklist.length;
    const cls   = done === total ? 'complete' : '';
    return `<span class="card-checklist-badge ${cls}">&#10003; ${done}/${total}</span>`;
  }

  function buildCardTagsHtml(tagIds) {
    if (!tagIds.length) return '';
    const allTags = Storage.getTags();
    const tags = tagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean);
    if (!tags.length) return '';
    return `<div class="card-tags">${tags.map(t => {
      const tc = getContrastColor(t.color);
      return `<span class="card-tag-pill" style="background:${t.color};color:${tc}">${Utils.escHtml(t.name)}</span>`;
    }).join('')}</div>`;
  }

  function buildAddColumnWidget() {
    const el = document.createElement('div');
    el.id = 'add-column-widget';
    el.innerHTML = `
      <button class="column-add-btn" id="btn-add-col-inline"
        style="min-width:200px;background:rgba(255,255,255,.5);border:2px dashed #c5cad8;
               border-radius:10px;padding:12px 16px;text-align:center;color:#6b7280;font-weight:600;">
        + Nova Coluna
      </button>
    `;
    el.querySelector('#btn-add-col-inline').addEventListener('click', showAddColumnInput);
    return el;
  }

  // ── Rename column inline ──────────────────────────────────────────────────
  function startRenameColumn(colId, colEl) {
    const span = colEl.querySelector(`[data-col-title="${colId}"]`);
    if (!span) return;
    const oldTitle = span.textContent;

    const input = document.createElement('input');
    input.className = 'column-title-input';
    input.value = oldTitle;
    span.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== oldTitle) {
        const cols = Storage.getColumns();
        const col  = cols.find(c => c.id === colId);
        if (col) { col.title = newTitle; Storage.saveColumn(col); }
      }
      renderBoard();
    };
    input.addEventListener('blur',    commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { renderBoard(); }
    });
  }

  // ── Add column inline ─────────────────────────────────────────────────────
  function showAddColumnInput() {
    const widget = $('add-column-widget');
    widget.innerHTML = `
      <div class="add-column-card">
        <input type="text" id="new-col-input" placeholder="Nome da coluna" autocomplete="off">
        <div class="add-column-actions">
          <button class="btn btn-primary btn-sm" id="btn-col-confirm">Adicionar</button>
          <button class="btn btn-ghost btn-sm" id="btn-col-cancel">Cancelar</button>
        </div>
      </div>
    `;
    const input = $('new-col-input');
    input.focus();

    const commit = () => {
      const title = input.value.trim();
      if (title) {
        Storage.saveColumn({ id: Utils.generateUUID(), title, order: 9999 });
      }
      renderBoard();
    };
    $('btn-col-confirm').addEventListener('click', commit);
    $('btn-col-cancel').addEventListener('click',  renderBoard);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  commit();
      if (e.key === 'Escape') renderBoard();
    });
  }

  // ── Delete column ─────────────────────────────────────────────────────────
  function deleteColumn(colId) {
    const cards = Storage.getCards(colId);
    const cols  = Storage.getColumns();
    const col   = cols.find(c => c.id === colId);
    const title = col ? col.title : 'esta coluna';
    const msg   = cards.length > 0
      ? `Excluir "${title}"? Os ${cards.length} card(s) dentro dela também serão removidos.`
      : `Excluir a coluna "${title}"?`;

    openConfirmModal(msg, () => {
      Storage.deleteColumn(colId);
      renderBoard();
      showToast('Coluna excluída.', 'info');
    });
  }

  // ── Card Modal ────────────────────────────────────────────────────────────
  function openCardModal(columnId, cardId = null) {
    currentEditingCardId = cardId || Utils.generateUUID();
    currentModalColumnId = columnId;
    selectedMemberIds    = [];
    selectedTagIds       = [];
    selectedPriority     = 'normal';
    currentChecklist     = [];
    isNewCard            = !cardId;
    cardWasSaved         = !!cardId;
    originalCardSnapshot = cardId ? JSON.parse(JSON.stringify(Storage.getCardById(cardId))) : null;

    $('modal-card-heading').textContent    = cardId ? 'Editar Card' : 'Novo Card';
    $('btn-card-delete').style.display     = cardId ? 'inline-flex' : 'none';
    $('btn-generate-rfc').style.display    = cardId ? 'inline-flex' : 'none';
    showAutosaveStatus('');

    const sel = $('card-select-column');
    sel.innerHTML = Storage.getColumns()
      .map(c => `<option value="${c.id}" ${c.id === columnId ? 'selected' : ''}>${Utils.escHtml(c.title)}</option>`)
      .join('');

    if (cardId) {
      const card = Storage.getCardById(cardId);
      if (card) {
        $('card-input-title').value    = card.title;
        $('card-input-deadline').value = card.deadline || '';
        $('card-description').value    = card.description || '';
        selectedPriority  = card.priority || 'normal';
        selectedMemberIds = [...(card.memberIds || [])];
        selectedTagIds    = [...(card.tagIds   || [])];
        currentChecklist  = (card.checklist || []).map(i => ({ ...i }));
        sel.value = card.columnId;
      }
    } else {
      $('card-input-title').value    = '';
      $('card-input-deadline').value = '';
      $('card-description').value    = '';
      // Pre-populate default checklist for new cards
      currentChecklist = DEFAULT_CHECKLIST.map(text => ({
        id: Utils.generateUUID(), text, done: false,
      }));
    }

    renderPrioritySelector();
    renderTagsSelector();
    renderMembersSelector();
    renderChecklist();
    renderComments();
    _setupCommentAvatar();
    // Mostra preview da descrição (textarea oculto por padrão)
    $('card-description').style.display = 'none';
    $('card-description-preview').style.display = '';
    $('btn-desc-edit-toggle').textContent = '✎ Editar';
    refreshDescPreview();
    $('modal-card').style.display = 'flex';
    $('card-input-title').focus();
  }

  function closeCardModal(discard = false) {
    if (discard) {
      if (isNewCard && cardWasSaved) {
        // Card novo auto-salvo: remove completamente
        Storage.deleteCard(currentEditingCardId);
        renderBoard();
      } else if (!isNewCard && originalCardSnapshot) {
        // Card existente: restaura o estado original
        Storage.saveCard(originalCardSnapshot);
        renderBoard();
      }
    }
    $('modal-card').style.display = 'none';
    currentEditingCardId    = null;
    isNewCard               = false;
    cardWasSaved            = false;
    originalCardSnapshot    = null;
  }

  function renderPrioritySelector() {
    $('card-priority-selector').querySelectorAll('.priority-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.priority === selectedPriority);
    });
  }

  function renderTagsSelector() {
    const tags = Storage.getTags();
    const sel  = $('card-tags-selector');

    if (!tags.length) {
      sel.innerHTML = '<span class="tags-empty">Nenhuma tag criada ainda.</span>';
      return;
    }

    sel.innerHTML = tags.map(t => {
      const selected = selectedTagIds.includes(t.id);
      const textColor = getContrastColor(t.color);
      return `
        <span class="tag-chip ${selected ? 'selected' : ''}"
              data-tag-id="${t.id}"
              style="background:${t.color};color:${textColor};
                     ${selected ? '' : 'opacity:.55;'}">
          ${Utils.escHtml(t.name)}
          <button class="tag-chip-del" data-del-tag="${t.id}" title="Excluir tag">&#10005;</button>
        </span>`;
    }).join('');

    sel.querySelectorAll('.tag-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        if (e.target.closest('.tag-chip-del')) return;
        const id = chip.dataset.tagId;
        if (selectedTagIds.includes(id)) {
          selectedTagIds = selectedTagIds.filter(x => x !== id);
        } else {
          selectedTagIds.push(id);
        }
        renderTagsSelector();
        autoSave();
      });
    });

    sel.querySelectorAll('[data-del-tag]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.delTag;
        const tag = tags.find(t => t.id === id);
        openConfirmModal(`Excluir a tag "${tag ? tag.name : ''}"?`, () => {
          Storage.deleteTag(id);
          selectedTagIds = selectedTagIds.filter(x => x !== id);
          renderTagsSelector();
        });
      });
    });
  }

  function createTag() {
    const nameInput  = $('tag-name-input');
    const colorInput = $('tag-color-input');
    const name = nameInput.value.trim();
    if (!name) { showToast('Digite o nome da tag.', 'warning'); nameInput.focus(); return; }
    Storage.saveTag({ id: Utils.generateUUID(), name, color: colorInput.value });
    nameInput.value  = '';
    colorInput.value = '#7B68EE';
    renderTagsSelector();
  }

  // Retorna #000 ou #fff dependendo da luminosidade da cor de fundo
  function getContrastColor(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
    return luminance > 0.55 ? '#1a1d23' : '#ffffff';
  }

  function renderMembersSelector() {
    const members = Storage.getMembers();
    const sel = $('card-members-selector');
    if (!members.length) {
      sel.innerHTML = '<span class="members-empty">Nenhum membro cadastrado. Adicione no Squad.</span>';
      return;
    }
    sel.innerHTML = members.map(m => {
      const avatarInner = m.photoUrl
        ? `<img src="${m.photoUrl}" alt="${Utils.escHtml(m.initials)}" class="avatar-sm-photo">`
        : Utils.escHtml(m.initials);
      const avatarBg = m.photoUrl ? 'transparent' : m.color;
      return `
        <div class="member-chip ${selectedMemberIds.includes(m.id) ? 'selected' : ''}" data-member-id="${m.id}">
          <span class="avatar-sm" style="background:${avatarBg};overflow:hidden">${avatarInner}</span>
          ${Utils.escHtml(m.name)}
        </div>`;
    }).join('');

    sel.querySelectorAll('.member-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.memberId;
        if (selectedMemberIds.includes(id)) {
          selectedMemberIds = selectedMemberIds.filter(x => x !== id);
          chip.classList.remove('selected');
        } else {
          selectedMemberIds.push(id);
          chip.classList.add('selected');
        }
        autoSave();
      });
    });
  }

  function renderChecklist() {
    const done  = currentChecklist.filter(i => i.done).length;
    const total = currentChecklist.length;
    const pct   = total ? Math.round((done / total) * 100) : 0;

    $('checklist-progress-label').textContent = total ? `${done} de ${total} concluídos` : '';

    $('card-checklist').innerHTML = `
      <div class="checklist-progress-bar">
        <div class="checklist-progress-fill" style="width:${pct}%"></div>
      </div>
      ${currentChecklist.map(item => `
        <div class="checklist-item ${item.done ? 'done' : ''}" data-item-id="${item.id}" draggable="true">
          <span class="cl-drag-handle" title="Arrastar">&#8942;&#8942;</span>
          <input type="checkbox" ${item.done ? 'checked' : ''} data-check="${item.id}">
          <span class="checklist-item-text">${Utils.escHtml(item.text)}</span>
          <button class="btn-icon" data-remove="${item.id}" title="Remover">&#10005;</button>
        </div>
      `).join('')}
    `;

    const container = $('card-checklist');

    container.querySelectorAll('input[data-check]').forEach(cb => {
      cb.addEventListener('change', () => {
        const item = currentChecklist.find(i => i.id === cb.dataset.check);
        if (item) { item.done = cb.checked; renderChecklist(); autoSave(); }
      });
    });

    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentChecklist = currentChecklist.filter(i => i.id !== btn.dataset.remove);
        renderChecklist();
        autoSave();
      });
    });

    // ── Drag-to-reorder ──
    container.querySelectorAll('.checklist-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        draggingChecklistId = item.dataset.itemId;
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation(); // impede arrastar a coluna por engano
        setTimeout(() => item.classList.add('cl-dragging'), 0);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('cl-dragging');
        draggingChecklistId = null;
        // Lê a nova ordem do DOM e comita no array
        const newOrder = [...container.querySelectorAll('.checklist-item')]
          .map(el => el.dataset.itemId);
        currentChecklist = newOrder
          .map(id => currentChecklist.find(i => i.id === id))
          .filter(Boolean);
        autoSave();
      });

      item.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!draggingChecklistId || draggingChecklistId === item.dataset.itemId) return;
        const draggingEl = container.querySelector(`[data-item-id="${draggingChecklistId}"]`);
        if (!draggingEl) return;
        const box  = item.getBoundingClientRect();
        const midY = box.top + box.height / 2;
        if (e.clientY < midY) container.insertBefore(draggingEl, item);
        else                   container.insertBefore(draggingEl, item.nextSibling);
      });
    });
  }

  // ── Comments ──────────────────────────────────────────────────────────────
  function renderComments() {
    const card = currentEditingCardId ? Storage.getCardById(currentEditingCardId) : null;
    const comments = (card && card.comments) || [];
    const me = Storage.getCurrentUser();

    const countEl = $('comments-count-label');
    if (countEl) countEl.textContent = comments.length ? `${comments.length} comentário${comments.length !== 1 ? 's' : ''}` : '';

    const list = $('card-comments-list');
    if (!list) return;

    if (!comments.length) {
      list.innerHTML = '<div class="comments-empty">Nenhum comentário ainda.</div>';
    } else {
      list.innerHTML = comments.map(c => {
        const isMe = me && c.authorId === me.id;
        const time = Utils.formatDateTime(c.createdAt);
        const inner = c.authorPhoto
          ? `<img src="${c.authorPhoto}" alt="${Utils.escHtml(c.authorInitials)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
          : Utils.escHtml(c.authorInitials);
        const bg = c.authorPhoto ? 'transparent' : c.authorColor;
        return `
          <div class="comment-item">
            <span class="avatar-comment" style="background:${bg}">${inner}</span>
            <div class="comment-body">
              <div class="comment-header">
                <span class="comment-author">${Utils.escHtml(c.authorName)}</span>
                <span class="comment-time">${time}</span>
                ${isMe ? `<button class="btn-icon comment-del-btn" data-comment-id="${c.id}" title="Excluir comentário">&#10005;</button>` : ''}
              </div>
              <div class="comment-text">${Utils.escHtml(c.text)}</div>
            </div>
          </div>`;
      }).join('');

      list.querySelectorAll('.comment-del-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteComment(btn.dataset.commentId));
      });

      list.scrollTop = list.scrollHeight;
    }

    const inputEl  = $('comment-input');
    const sendBtn  = $('btn-comment-send');
    const cardExists = !!card;
    if (inputEl) {
      inputEl.disabled    = !cardExists;
      inputEl.placeholder = cardExists ? 'Adicionar comentário...' : 'Digite um título para salvar o card antes de comentar';
    }
    if (sendBtn) sendBtn.disabled = !cardExists;
  }

  function _setupCommentAvatar() {
    const me = Storage.getCurrentUser();
    const el = $('comment-me-avatar');
    if (!el) return;
    if (!me) { el.textContent = '?'; el.style.background = '#9e9e9e'; return; }
    if (me.photoUrl) {
      el.innerHTML = `<img src="${me.photoUrl}" alt="${Utils.escHtml(me.initials)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      el.style.background = 'transparent';
    } else {
      el.textContent = me.initials;
      el.style.background = me.color;
    }
  }

  function addComment() {
    const inputEl = $('comment-input');
    const text    = inputEl ? inputEl.value.trim() : '';
    if (!text || !currentEditingCardId) return;

    const card = Storage.getCardById(currentEditingCardId);
    if (!card) { showToast('Salve o card antes de comentar.', 'warning'); return; }

    const me = Storage.getCurrentUser();
    const comment = {
      id:             Utils.generateUUID(),
      authorId:       me ? me.id       : 'anon',
      authorName:     me ? me.name     : 'Anônimo',
      authorInitials: me ? me.initials : '?',
      authorColor:    me ? me.color    : '#888',
      authorPhoto:    me ? (me.photoUrl || null) : null,
      text,
      createdAt: new Date().toISOString(),
    };

    card.comments = [...(card.comments || []), comment];
    Storage.saveCard(card);
    if (inputEl) inputEl.value = '';
    renderComments();
  }

  function deleteComment(commentId) {
    const card = Storage.getCardById(currentEditingCardId);
    if (!card) return;
    card.comments = (card.comments || []).filter(c => c.id !== commentId);
    Storage.saveCard(card);
    renderComments();
  }

  function addChecklistItem() {
    const input = $('checklist-new-item');
    const text  = input.value.trim();
    if (!text) return;
    currentChecklist.push({ id: Utils.generateUUID(), text, done: false });
    input.value = '';
    renderChecklist();
    autoSave();
    input.focus();
  }

  // Lógica de persistência compartilhada entre saveCard e autoSave
  function _persistCard() {
    const card = {
      id:        currentEditingCardId,
      columnId:  $('card-select-column').value,
      title:     $('card-input-title').value.trim(),
      priority:  selectedPriority,
      deadline:  $('card-input-deadline').value || null,
      memberIds: [...selectedMemberIds],
      tagIds:    [...selectedTagIds],
      checklist:   currentChecklist.map(i => ({ ...i })),
      description: $('card-description').value.trim() || null,
    };
    const existing = Storage.getCardById(currentEditingCardId);
    if (existing) {
      card.order     = existing.order;
      card.createdAt = existing.createdAt;
    }
    Storage.saveCard(card);
    cardWasSaved = true;
  }

  // ── Markdown simples para preview da descrição ───────────────────────────
  function applyInline(str) {
    return str
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function renderDescMarkdown(text) {
    if (!text) return '';
    const lines  = text.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
      const line    = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        result.push('<div style="height:.5em"></div>');
        i++;
      } else if (trimmed.startsWith('### ')) {
        result.push(`<h3>${applyInline(trimmed.slice(4))}</h3>`);
        i++;
      } else if (trimmed.startsWith('## ')) {
        result.push(`<h2>${applyInline(trimmed.slice(3))}</h2>`);
        i++;
      } else if (trimmed.startsWith('# ')) {
        result.push(`<h1>${applyInline(trimmed.slice(2))}</h1>`);
        i++;
      } else if (trimmed === '---') {
        result.push('<hr>');
        i++;
      } else if (trimmed.startsWith('- ')) {
        const items = [];
        while (i < lines.length && lines[i].trim().startsWith('- ')) {
          items.push(`<li>${applyInline(lines[i].trim().slice(2))}</li>`);
          i++;
        }
        result.push(`<ul>${items.join('')}</ul>`);
      } else {
        const pLines = [];
        while (i < lines.length) {
          const t = lines[i].trim();
          if (!t || t.startsWith('- ') || t.startsWith('#') || t === '---') break;
          pLines.push(applyInline(lines[i]));
          i++;
        }
        result.push(`<p>${pLines.join('<br>')}</p>`);
      }
    }
    return result.join('');
  }

  function refreshDescPreview() {
    const text = $('card-description').value;
    $('card-description-preview').innerHTML = renderDescMarkdown(text);
  }

  function toggleDescEdit() {
    const preview  = $('card-description-preview');
    const textarea = $('card-description');
    const btn      = $('btn-desc-edit-toggle');
    const editing  = textarea.style.display !== 'none';
    if (editing) {
      refreshDescPreview();
      textarea.style.display = 'none';
      preview.style.display  = '';
      btn.textContent = '✎ Editar';
    } else {
      preview.style.display  = 'none';
      textarea.style.display = '';
      textarea.focus();
      btn.textContent = '✓ Visualizar';
    }
  }

function autoSave() {
    const title = $('card-input-title').value.trim();
    if (!title) { showAutosaveStatus(''); return; }
    showAutosaveStatus('saving');
    _persistCard();
    renderBoard();
    showAutosaveStatus('saved');
    if (cardWasSaved) {
      $('btn-generate-rfc').style.display = 'inline-flex';
      $('btn-card-delete').style.display  = 'inline-flex';
      renderComments();
    }
  }

  const autoSaveDebounced = Utils.debounce(autoSave, 700);

  let _autosaveFadeTimer = null;

  function showAutosaveStatus(state) {
    const el = $('card-autosave-status');
    if (!el) return;
    clearTimeout(_autosaveFadeTimer);
    if (state === 'saving') {
      el.textContent = 'Salvando…';
      el.className   = 'autosave-status saving';
    } else if (state === 'saved') {
      el.textContent = '✓ Salvo';
      el.className   = 'autosave-status saved';
      _autosaveFadeTimer = setTimeout(() => {
        el.textContent = '';
        el.className   = 'autosave-status';
      }, 2000);
    } else {
      el.textContent = '';
      el.className   = 'autosave-status';
    }
  }

  function deleteCard(cardId) {
    const card = Storage.getCardById(cardId);
    const title = card ? card.title : 'este card';
    openConfirmModal(`Excluir "${title}"?`, () => {
      Storage.deleteCard(cardId);
      closeCardModal();
      renderBoard();
      showToast('Card excluído.', 'info');
    });
  }

  // ── Squad / Filter Modal ──────────────────────────────────────────────────
  function openSquadModal() {
    renderSquadList();
    $('modal-members').style.display = 'flex';
  }

  function closeSquadModal() {
    $('modal-members').style.display = 'none';
  }

  function renderSquadList() {
    const members  = Storage.getMembers();
    const tags     = Storage.getTags();
    const list     = $('squad-filter-list');
    const clearBtn = $('btn-clear-filter');
    const allCards = Storage.getColumns().flatMap(col => Storage.getCards(col.id));
    const hasFilter = filterMemberIds.size > 0 || filterTagIds.size > 0 || filterPriorities.size > 0;

    let html = '';

    // ── Seção Membros ──
    html += `<div class="filter-section-label">Membros</div>`;
    if (!members.length) {
      html += '<p class="members-empty-state">Nenhum membro no squad ainda.</p>';
    } else {
      html += members.map(m => {
        const count    = allCards.filter(c => (c.memberIds || []).includes(m.id)).length;
        const isActive = filterMemberIds.has(m.id);
        const avatarInner = m.photoUrl
          ? `<img src="${m.photoUrl}" alt="${Utils.escHtml(m.initials)}">`
          : Utils.escHtml(m.initials);
        const avatarBg = m.photoUrl ? 'transparent' : m.color;
        return `
          <div class="squad-member-chip ${isActive ? 'active' : ''}" data-member-id="${m.id}">
            <span class="avatar squad-avatar" style="background:${avatarBg}">${avatarInner}</span>
            <div class="squad-member-info">
              <span class="squad-member-name">${Utils.escHtml(m.name)}</span>
              <span class="squad-member-count">${count} card${count !== 1 ? 's' : ''}</span>
            </div>
            ${isActive ? '<span class="squad-active-badge">✓</span>' : ''}
            <button class="btn-icon squad-delete-btn" data-action="delete-member" data-member="${m.id}" title="Remover do squad">&#128465;</button>
          </div>`;
      }).join('');
    }

    // ── Seção Prioridade ──
    html += `<div class="filter-section-label" style="margin-top:12px">Prioridade</div>`;
    const PRIORITIES = [
      { key: 'urgent', label: 'Urgente', color: '#f44336' },
      { key: 'normal', label: 'Normal',  color: '#28a745' },
      { key: 'low',    label: 'Baixa',   color: '#9e9e9e' },
    ];
    html += `<div class="filter-tags-grid">`;
    html += PRIORITIES.map(p => {
      const isActive = filterPriorities.has(p.key);
      const count    = allCards.filter(c => (c.priority || 'normal') === p.key).length;
      return `
        <div class="filter-priority-chip ${isActive ? 'active' : ''}" data-priority="${p.key}"
             style="--p-color:${p.color};background:${isActive ? p.color + '22' : '#f0f2f5'};
                    border-color:${isActive ? p.color : '#dde1e7'};
                    color:${isActive ? p.color : '#555'}">
          <span class="filter-priority-dot" style="background:${p.color}"></span>
          ${p.label}
          <span class="filter-tag-count">${count}</span>
        </div>`;
    }).join('');
    html += `</div>`;

    // ── Seção Tags ──
    html += `<div class="filter-section-label" style="margin-top:12px">Tags</div>`;
    if (!tags.length) {
      html += '<p class="members-empty-state">Nenhuma tag criada ainda.</p>';
    } else {
      html += `<div class="filter-tags-grid">`;
      html += tags.map(t => {
        const isActive  = filterTagIds.has(t.id);
        const textColor = getContrastColor(t.color);
        const count     = allCards.filter(c => (c.tagIds || []).includes(t.id)).length;
        return `
          <div class="filter-tag-chip ${isActive ? 'active' : ''}" data-tag-id="${t.id}"
               style="background:${isActive ? t.color : '#f0f2f5'};
                      color:${isActive ? textColor : '#555'};
                      border-color:${t.color}">
            ${Utils.escHtml(t.name)}
            <span class="filter-tag-count">${count}</span>
          </div>`;
      }).join('');
      html += `</div>`;
    }

    list.innerHTML = html;
    const footer = $('filter-modal-footer');
    if (footer) footer.style.display = hasFilter ? '' : 'none';

    list.querySelectorAll('.squad-member-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        if (e.target.closest('[data-action="delete-member"]')) return;
        const id = chip.dataset.memberId;
        if (filterMemberIds.has(id)) filterMemberIds.delete(id);
        else filterMemberIds.add(id);
        renderSquadList();
        renderBoard();
        _updateFilterButton();
      });
    });

    list.querySelectorAll('[data-action="delete-member"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const m = members.find(x => x.id === btn.dataset.member);
        openConfirmModal(`Remover "${m ? m.name : ''}" do squad?`, () => {
          filterMemberIds.delete(btn.dataset.member);
          Storage.deleteMember(btn.dataset.member);
          renderSquadList();
          renderBoard();
          _updateFilterButton();
          showToast('Membro removido.', 'info');
        });
      });
    });

    list.querySelectorAll('.filter-tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.tagId;
        if (filterTagIds.has(id)) filterTagIds.delete(id);
        else filterTagIds.add(id);
        renderSquadList();
        renderBoard();
        _updateFilterButton();
      });
    });

    list.querySelectorAll('.filter-priority-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.priority;
        if (filterPriorities.has(key)) filterPriorities.delete(key);
        else filterPriorities.add(key);
        renderSquadList();
        renderBoard();
        _updateFilterButton();
      });
    });
  }

  function _updateFilterButton() {
    const btn   = $('btn-manage-members');
    if (!btn) return;
    const total = filterMemberIds.size + filterTagIds.size + filterPriorities.size;
    if (total === 0) {
      btn.innerHTML = '⊟ Filtro';
      btn.classList.remove('squad-filter-active');
    } else {
      btn.innerHTML = `⊟ Filtro <span style="background:rgba(255,255,255,.3);border-radius:10px;padding:1px 7px;font-size:.75rem">${total}</span>`;
      btn.classList.add('squad-filter-active');
    }
  }

  // ── Confirm Modal ─────────────────────────────────────────────────────────
  function openConfirmModal(text, onConfirm) {
    $('modal-confirm-text').textContent = text;
    confirmCallback = onConfirm;
    $('modal-confirm').style.display = 'flex';
  }

  function closeConfirmModal() {
    $('modal-confirm').style.display = 'none';
    confirmCallback = null;
  }

  // ── Drag & Drop — Cards ───────────────────────────────────────────────────
  function onCardDragStart(e) {
    draggingCardId  = e.currentTarget.dataset.cardId;
    draggingColId   = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('type', 'card');
    setTimeout(() => e.currentTarget.classList.add('dragging'), 0);
    e.stopPropagation();
  }

  function onCardDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    draggingCardId = null;
    document.querySelectorAll('.drag-placeholder').forEach(p => p.remove());
  }

  // ── Drag & Drop — Columns ─────────────────────────────────────────────────
  function onColumnDragStart(e) {
    if (draggingCardId) return; // card drag takes priority
    const col = e.currentTarget;
    draggingColId = col.dataset.columnId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('type', 'column');
    setTimeout(() => col.classList.add('dragging-col'), 0);
  }

  function onColumnDragEnd(e) {
    e.currentTarget.classList.remove('dragging-col');
    document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over-col'));
    draggingColId = null;
  }

  function onColumnDragOver(e) {
    e.preventDefault();

    if (draggingCardId) {
      // Handle card over this column
      e.dataTransfer.dropEffect = 'move';
      const dropZone = e.currentTarget.querySelector('.column-cards');
      if (!dropZone) return;

      document.querySelectorAll('.drag-placeholder').forEach(p => p.remove());
      const placeholder = document.createElement('div');
      placeholder.className = 'drag-placeholder';

      const afterEl = getDragAfterElement(dropZone, e.clientY);
      if (afterEl) dropZone.insertBefore(placeholder, afterEl);
      else          dropZone.appendChild(placeholder);

    } else if (draggingColId && e.currentTarget.dataset.columnId !== draggingColId) {
      e.currentTarget.classList.add('drag-over-col');
    }
  }

  function onColumnDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drag-over-col');
    }
  }

  function onColumnDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.drag-placeholder').forEach(p => p.remove());

    if (draggingCardId) {
      const targetColId = e.currentTarget.dataset.columnId;
      if (!targetColId) return;

      const dropZone  = e.currentTarget.querySelector('.column-cards');
      const afterEl   = getDragAfterElement(dropZone, e.clientY);
      const newOrder  = afterEl
        ? parseInt(afterEl.dataset.cardId ? Storage.getCardById(afterEl.dataset.cardId)?.order ?? 0 : 0)
        : Storage.getCards(targetColId).length;

      Storage.moveCard(draggingCardId, targetColId, newOrder);
      draggingCardId = null;
      renderBoard();

    } else if (draggingColId) {
      const targetColId = e.currentTarget.dataset.columnId;
      if (!targetColId || targetColId === draggingColId) return;

      const cols    = Storage.getColumns();
      const target  = cols.find(c => c.id === targetColId);
      if (target) Storage.moveColumn(draggingColId, target.order);
      e.currentTarget.classList.remove('drag-over-col');
      draggingColId = null;
      renderBoard();
    }
  }

  function getDragAfterElement(container, y) {
    const cards = [...container.querySelectorAll('.kanban-card:not(.dragging)')];
    return cards.reduce((closest, child) => {
      const box    = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }


  // ── Global Event Bindings ─────────────────────────────────────────────────
  function bindGlobalEvents() {
    // Header buttons
    // Busca global
    const searchInput = $('input-global-search');
    const searchClear = $('btn-search-clear');
    let _searchTimer  = null;

    searchInput.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        filterSearch = searchInput.value.trim();
        searchClear.style.display = filterSearch ? '' : 'none';
        renderBoard();
      }, 200);
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      filterSearch = '';
      searchClear.style.display = 'none';
      searchInput.focus();
      renderBoard();
    });

    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') searchClear.click();
    });

    $('btn-manage-members').addEventListener('click', openSquadModal);

    $('btn-deadline-alert').addEventListener('click', () => {
      filterDeadline = !filterDeadline;
      const btn = $('btn-deadline-alert');
      btn.classList.toggle('active', filterDeadline);
      renderBoard();
    });

    $('btn-add-column').addEventListener('click', showAddColumnInput);

    // Board delegation
    $('kanban-board').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const colId  = btn.dataset.col;
      if (action === 'add-card')   openCardModal(colId);
      if (action === 'delete-col') deleteColumn(colId);
    });

    // Card modal
    $('btn-card-close').addEventListener('click',  () => closeCardModal(false));
    $('btn-card-cancel').addEventListener('click', () => closeCardModal(true));
    $('btn-card-save').addEventListener('click',   () => closeCardModal(false));
    $('btn-card-delete').addEventListener('click', () => deleteCard(currentEditingCardId));
    $('btn-desc-edit-toggle').addEventListener('click', toggleDescEdit);

    $('btn-generate-rfc').addEventListener('click', () => {
      if (currentEditingCardId) {
        window.location.href = `rfc.html?card=${currentEditingCardId}`;
      }
    });

    $('btn-open-hld').addEventListener('click', () => {
      const title = $('card-input-title').value.trim();
      const url   = 'hld-compare.html?popup=1' + (title ? '&project=' + encodeURIComponent(title) : '');
      window.open(url, 'hld-popup', 'width=900,height=700,resizable=yes,scrollbars=yes');
    });

    window.addEventListener('message', e => {
      if (e.data && e.data.type === 'hld-result') {
        $('card-description').value = e.data.text;
        // Volta para o preview com o conteúdo renderizado
        $('card-description').style.display = 'none';
        $('card-description-preview').style.display = '';
        $('btn-desc-edit-toggle').textContent = '✎ Editar';
        refreshDescPreview();
        autoSave();
      }
    });

    // Auto-save: título com debounce, demais campos imediato
    $('card-input-title').addEventListener('input',       () => autoSaveDebounced());
    $('card-input-deadline').addEventListener('change',   () => autoSave());
    $('card-select-column').addEventListener('change',    () => autoSave());
    $('card-description').addEventListener('input',       () => autoSaveDebounced());

    $('btn-tag-create').addEventListener('click', createTag);
    $('tag-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); createTag(); }
    });

    $('btn-checklist-add').addEventListener('click', addChecklistItem);
    $('checklist-new-item').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
    });

    $('btn-comment-send').addEventListener('click', addComment);
    $('comment-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addComment(); }
    });

    $('card-priority-selector').addEventListener('click', e => {
      const btn = e.target.closest('.priority-btn');
      if (!btn) return;
      selectedPriority = btn.dataset.priority;
      renderPrioritySelector();
      autoSave();
    });

    // Squad modal
    $('btn-members-close').addEventListener('click', closeSquadModal);
    $('btn-clear-filter').addEventListener('click', () => {
      filterMemberIds.clear();
      filterTagIds.clear();
      filterPriorities.clear();
      renderSquadList();
      renderBoard();
      _updateFilterButton();
    });

    // Confirm modal
    $('btn-confirm-close').addEventListener('click',  closeConfirmModal);
    $('btn-confirm-cancel').addEventListener('click', closeConfirmModal);
    $('btn-confirm-ok').addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
      closeConfirmModal();
    });

    // Close modals on backdrop click
    ['modal-card', 'modal-members', 'modal-confirm'].forEach(id => {
      $(id).addEventListener('click', e => {
        if (e.target === $(id)) {
          if (id === 'modal-card')    closeCardModal(false);
          if (id === 'modal-members') closeSquadModal();
          if (id === 'modal-confirm') closeConfirmModal();
        }
      });
    });

    // Keyboard: Esc closes open modal
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if ($('modal-card').style.display    !== 'none') closeCardModal(false);
      if ($('modal-members').style.display !== 'none') closeSquadModal();
      if ($('modal-confirm').style.display !== 'none') closeConfirmModal();
    });

    // Fechar modal com Escape no título
    $('card-input-title').addEventListener('keydown', e => {
      if (e.key === 'Escape') closeCardModal(false);
    });
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2800);
    setTimeout(() => el.remove(), 3200);
  }

  return { init };

})();
