/* ============================================================
   Tela de login
   ============================================================ */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, { method = 'GET', body } = {}) {
  const resp = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const erro = new Error(data.erro || 'Erro na requisição.');
    erro.status = resp.status;
    erro.restantes = data.restantes;
    throw erro;
  }
  return data;
}

/* já autenticado? vai direto para o sistema */
(async function iniciar() {
  try {
    await api('/api/auth/me');
    location.replace('/');
  } catch (e) { /* sem sessão: permanece na tela de login */ }

  const params = new URLSearchParams(location.search);
  const aviso = $('#avisoEmail');
  const msgs = {
    confirmado: ['success', 'E-mail confirmado com sucesso. Você já pode usar a recuperação de senha.'],
    invalido: ['warning', 'Link inválido ou expirado. Solicite um novo link de confirmação.'],
    trocada: ['success', 'Senha alterada. Entre com a nova senha.'],
    expirada: ['warning', 'Sua sessão expirou. Entre novamente.']
  };
  const chave = params.get('email') || params.get('senha');
  if (msgs[chave]) {
    aviso.className = `alert alert-${msgs[chave][0]}`;
    aviso.innerHTML = `<span class="material-symbols-outlined me-1" style="font-size:1.1rem">info</span>${esc(msgs[chave][1])}`;
  }
  if (params.get('usuario')) $('#usuario').value = params.get('usuario');

  $('#btnVerSenha').addEventListener('click', () => {
    const campo = $('#senha');
    const showing = campo.type === 'text';
    campo.type = showing ? 'password' : 'text';
    $('#btnVerSenha .material-symbols-outlined').textContent = showing ? 'visibility' : 'visibility_off';
  });

  $('#formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btnEntrar');
    const usuario = $('#usuario').value.trim();
    const senha = $('#senha').value;
    if (!usuario || !senha) return;

    aviso.className = 'alert d-none';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Entrando...';

    try {
      await api('/api/auth/login', { method: 'POST', body: { usuario, senha } });
      location.href = '/';
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined me-1">login</span> Entrar';
      aviso.className = 'alert alert-danger';
      aviso.innerHTML = `<span class="material-symbols-outlined me-1" style="font-size:1.1rem">error</span>${esc(err.message)}`;
      if (typeof err.restantes === 'number' && err.restantes > 0) {
        $('#tentativas').textContent = `Faltam ${err.restantes} tentativa(s) antes do bloqueio temporário.`;
      } else {
        $('#tentativas').textContent = '';
      }
      $('#senha').value = '';
      $('#senha').focus();
    }
  });
})();
