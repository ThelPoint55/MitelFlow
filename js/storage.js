'use strict';

const Storage = (() => {
  const KEY = 'qa_kanban';

  const DEFAULT_COLUMNS = [
    'Backlog',
    'Design / Marcações',
    'Prontos para Desenvolver',
    'Em Desenvolvimento',
    'Homologação',
    'Certificação',
    'Go Live',
    'Atualização de Documentação',
    'Feitos',
  ];

  function initDefaults() {
    const columns = DEFAULT_COLUMNS.map((title, i) => ({
      id: Utils.generateUUID(),
      title,
      order: i,
    }));
    const state = {
      version: 1,
      updatedAt: new Date().toISOString(),
      settings: { notificationPermissionAsked: false },
      members: [],
      tags: [],
      columns,
      cards: [],
    };
    persist(state);
    return state;
  }

  function persist(state) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return initDefaults();
      const state = JSON.parse(raw);
      if (!state.version || !state.columns) return initDefaults();
      return state;
    } catch {
      return initDefaults();
    }
  }

  function save(state) {
    persist(state);
  }

  // ── Columns ───────────────────────────────────────────────────────────────

  function getColumns() {
    return load().columns.slice().sort((a, b) => a.order - b.order);
  }

  function saveColumn(col) {
    const state = load();
    const idx = state.columns.findIndex(c => c.id === col.id);
    if (idx >= 0) {
      state.columns[idx] = col;
    } else {
      col.order = state.columns.length;
      state.columns.push(col);
    }
    persist(state);
  }

  function deleteColumn(id) {
    const state = load();
    state.columns = state.columns.filter(c => c.id !== id);
    state.cards   = state.cards.filter(c => c.columnId !== id);
    reindexColumns(state);
    persist(state);
  }

  function moveColumn(colId, newOrder) {
    const state = load();
    const col = state.columns.find(c => c.id === colId);
    if (!col) return;
    const oldOrder = col.order;
    if (oldOrder === newOrder) return;
    state.columns.forEach(c => {
      if (oldOrder < newOrder) {
        if (c.order > oldOrder && c.order <= newOrder) c.order--;
      } else {
        if (c.order >= newOrder && c.order < oldOrder) c.order++;
      }
    });
    col.order = newOrder;
    persist(state);
  }

  function reindexColumns(state) {
    state.columns
      .sort((a, b) => a.order - b.order)
      .forEach((c, i) => { c.order = i; });
  }

  // ── Cards ─────────────────────────────────────────────────────────────────

  function getCards(columnId) {
    return load().cards
      .filter(c => c.columnId === columnId)
      .sort((a, b) => a.order - b.order);
  }

  function getAllCards() {
    return load().cards;
  }

  function getCardById(id) {
    return load().cards.find(c => c.id === id) || null;
  }

  function saveCard(card) {
    const state = load();
    card.updatedAt = new Date().toISOString();
    const idx = state.cards.findIndex(c => c.id === card.id);
    if (idx >= 0) {
      state.cards[idx] = card;
    } else {
      card.createdAt = card.createdAt || new Date().toISOString();
      const colCards = state.cards.filter(c => c.columnId === card.columnId);
      card.order = colCards.length;
      state.cards.push(card);
    }
    persist(state);
  }

  function deleteCard(id) {
    const state = load();
    const card = state.cards.find(c => c.id === id);
    if (!card) return;
    state.cards = state.cards.filter(c => c.id !== id);
    reindexCards(state, card.columnId);
    persist(state);
  }

  function moveCard(cardId, newColumnId, newOrder) {
    const state = load();
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;

    const oldColumnId = card.columnId;

    // Remove from old column and reindex
    state.cards.filter(c => c.columnId === oldColumnId && c.id !== cardId)
      .sort((a, b) => a.order - b.order)
      .forEach((c, i) => { c.order = i; });

    // Make room in new column
    state.cards.filter(c => c.columnId === newColumnId && c.id !== cardId)
      .sort((a, b) => a.order - b.order)
      .forEach(c => { if (c.order >= newOrder) c.order++; });

    card.columnId = newColumnId;
    card.order    = newOrder;
    card.updatedAt = new Date().toISOString();

    persist(state);
  }

  function reindexCards(state, columnId) {
    state.cards
      .filter(c => c.columnId === columnId)
      .sort((a, b) => a.order - b.order)
      .forEach((c, i) => { c.order = i; });
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  function getTags() {
    const state = load();
    return state.tags || [];
  }

  function saveTag(tag) {
    const state = load();
    if (!state.tags) state.tags = [];
    const idx = state.tags.findIndex(t => t.id === tag.id);
    if (idx >= 0) {
      state.tags[idx] = tag;
    } else {
      state.tags.push(tag);
    }
    persist(state);
  }

  function deleteTag(id) {
    const state = load();
    state.tags = (state.tags || []).filter(t => t.id !== id);
    state.cards.forEach(c => {
      c.tagIds = (c.tagIds || []).filter(tid => tid !== id);
    });
    persist(state);
  }

  // ── Members ───────────────────────────────────────────────────────────────

  function getMembers() {
    return load().members;
  }

  function saveMember(member) {
    const state = load();
    const idx = state.members.findIndex(m => m.id === member.id);
    if (idx >= 0) {
      state.members[idx] = member;
    } else {
      state.members.push(member);
    }
    persist(state);
  }

  function deleteMember(id) {
    const state = load();
    state.members = state.members.filter(m => m.id !== id);
    state.cards.forEach(c => {
      c.memberIds = (c.memberIds || []).filter(mid => mid !== id);
    });
    persist(state);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  function getSettings() {
    return load().settings || {};
  }

  function saveSetting(key, value) {
    const state = load();
    state.settings = state.settings || {};
    state.settings[key] = value;
    persist(state);
  }

  // ── Current User (proxy para auth.js) ────────────────────────────────────

  function getCurrentUser() {
    try {
      const raw = localStorage.getItem('qa_current_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setCurrentUser(user) {
    localStorage.setItem('qa_current_user', JSON.stringify(user));
  }

  function clearCurrentUser() {
    localStorage.removeItem('qa_current_user');
  }

  return {
    load,
    save,
    getColumns,
    saveColumn,
    deleteColumn,
    moveColumn,
    getCards,
    getAllCards,
    getCardById,
    saveCard,
    deleteCard,
    moveCard,
    getTags,
    saveTag,
    deleteTag,
    getMembers,
    saveMember,
    deleteMember,
    getSettings,
    saveSetting,
    getCurrentUser,
    setCurrentUser,
    clearCurrentUser,
  };
})();
