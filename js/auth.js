'use strict';

const Auth = (() => {
  const USER_KEY = 'qa_current_user';

  let msalInstance = null;
  let _onReady     = null;
  let _initialized = false;

  // ── Inicialização ──────────────────────────────────────────────────────────

  function init(onReady) {
    _onReady = onReady;

    if (!window.msal) {
      console.error('[Auth] MSAL não carregado. Verifique a tag <script> do CDN.');
      _showOverlay();
      return;
    }

    const msalConfig = {
      auth: {
        clientId:    AUTH_CONFIG.clientId,
        authority:   `https://login.microsoftonline.com/${AUTH_CONFIG.tenantId}`,
        redirectUri: AUTH_CONFIG.redirectUri,
      },
      cache: {
        cacheLocation:          'localStorage',
        storeAuthStateInCookie: false,
      },
    };

    try {
      msalInstance = new msal.PublicClientApplication(msalConfig);
    } catch (e) {
      console.error('[Auth] Erro ao criar instância MSAL:', e);
      _showOverlay();
      return;
    }

    // MSAL 2.x: handleRedirectPromise deve ser chamado sempre no carregamento
    msalInstance.handleRedirectPromise()
      .then(resp => {
        if (resp && resp.account) {
          msalInstance.setActiveAccount(resp.account);
          _storeUser(resp.account);
          _initialized = true;
          _fetchPhoto(resp.accessToken).finally(() => {
            _populateSidebar();
            _hideOverlay();
            _onReady && _onReady(getUser());
          });
          return;
        }
        _initialized = true;
        _trySilent();
      })
      .catch(err => {
        console.warn('[Auth] handleRedirectPromise erro:', err);
        _initialized = true;
        _trySilent();
      });
  }

  function _trySilent() {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length === 0) {
      _showOverlay();
      return;
    }

    msalInstance.setActiveAccount(accounts[0]);
    msalInstance.acquireTokenSilent({
      scopes:  AUTH_CONFIG.scopes,
      account: accounts[0],
    })
    .then(resp => {
      _storeUser(resp.account);
      _fetchPhoto(resp.accessToken).finally(() => {
        _populateSidebar();
        _hideOverlay();
        _onReady && _onReady(getUser());
      });
    })
    .catch(() => {
      _showOverlay();
    });
  }

  // ── Login / Logout ─────────────────────────────────────────────────────────

  function login() {
    if (!msalInstance) {
      console.error('[Auth] MSAL não inicializado.');
      return;
    }
    msalInstance.loginRedirect({ scopes: AUTH_CONFIG.scopes });
  }

  function logout() {
    clearUser();
    if (msalInstance) {
      const account = msalInstance.getActiveAccount();
      msalInstance.logoutPopup({ account }).catch(() => {});
    }
    _showOverlay();
  }

  // ── Dados do usuário ───────────────────────────────────────────────────────

  function _storeUser(account) {
    const name     = account.name || account.username.split('@')[0];
    const email    = account.username;
    const initials = _getInitials(name);
    const color    = _colorFromEmail(email);
    const user     = {
      id: account.localAccountId || account.homeAccountId,
      name, email, initials, color,
    };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function clearUser() {
    localStorage.removeItem(USER_KEY);
  }

  function _getInitials(name) {
    return name.trim().split(/\s+/)
      .slice(0, 2)
      .map(p => p[0].toUpperCase())
      .join('');
  }

  function _colorFromEmail(email) {
    const palette = ['#4CAF50','#2196F3','#FF9800','#9C27B0','#00BCD4','#E91E63','#607D8B','#F44336','#009688'];
    let h = 0;
    for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) & 0xfffffff;
    return palette[h % palette.length];
  }

  // ── Foto de perfil via Microsoft Graph ────────────────────────────────────

  function _fetchPhoto(accessToken) {
    return fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    .then(r => {
      if (!r.ok) return;
      return r.blob();
    })
    .then(blob => {
      if (!blob) return;
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => {
          const user = getUser();
          if (user) {
            user.photoUrl = reader.result;
            localStorage.setItem(USER_KEY, JSON.stringify(user));
          }
          resolve();
        };
        reader.readAsDataURL(blob);
      });
    })
    .catch(() => {});
  }

  // ── Overlay ────────────────────────────────────────────────────────────────

  function _showOverlay() {
    const overlay = document.getElementById('auth-overlay');
    const shell   = document.getElementById('app-shell-content');
    if (overlay) overlay.style.display = 'flex';
    if (shell)   shell.style.display   = 'none';
  }

  function _hideOverlay() {
    const overlay = document.getElementById('auth-overlay');
    const shell   = document.getElementById('app-shell-content');
    if (overlay) overlay.style.display = 'none';
    if (shell)   shell.style.display   = '';
  }

  // ── Sidebar ────────────────────────────────────────────────────────────────

  function _populateSidebar() {
    const user = getUser();
    if (!user) return;

    const avatarEl = document.getElementById('sidebar-user-avatar');
    const nameEl   = document.getElementById('sidebar-user-name');
    const emailEl  = document.getElementById('sidebar-user-email');

    if (avatarEl) {
      if (user.photoUrl) {
        avatarEl.style.background = 'transparent';
        avatarEl.innerHTML        = `<img src="${user.photoUrl}" alt="${user.initials}">`;
      } else {
        avatarEl.innerHTML        = '';
        avatarEl.textContent      = user.initials;
        avatarEl.style.background = user.color;
      }
    }
    if (nameEl)  nameEl.textContent  = user.name;
    if (emailEl) emailEl.textContent = user.email;

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.onclick = () => logout();
  }

  // ── Guard para rfc.html / hld-compare.html ────────────────────────────────

  function requireAuth() {
    const user = getUser();
    if (!user) {
      window.location.href = 'index.html';
      return null;
    }
    _populateSidebar();
    return user;
  }

  return { init, login, logout, getUser, clearUser, requireAuth };
})();
