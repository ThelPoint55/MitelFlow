'use strict';

const FirebaseSync = (() => {
  let db        = null;
  let _onRemote = null;
  let _skipNext = 0;
  let _ready    = false;

  function init(onReady, onRemote) {
    _onRemote = onRemote;

    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();

    db.ref('board').on('value', snapshot => {
      const data = snapshot.val();

      if (!_ready) {
        _ready = true;
        onReady(data);
        return;
      }

      // Ignora o echo das próprias escritas
      if (_skipNext > 0) { _skipNext--; return; }

      // Atualização veio de outro usuário
      if (_onRemote && data) _onRemote(data);
    });
  }

  function push(state) {
    if (!db) return;
    _skipNext++;
    db.ref('board').set({
      version:  state.version  || 1,
      settings: state.settings || {},
      members:  state.members  || [],
      tags:     state.tags     || [],
      columns:  state.columns  || [],
      cards:    state.cards    || [],
    });
  }

  return { init, push };
})();
