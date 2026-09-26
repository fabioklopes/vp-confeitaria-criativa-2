/* ============================================================
   Recuperação de senha: solicita o link e cadastra a nova senha
   ============================================================ */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

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
    throw erro;
  }
  return data;
}

function alerta(sel, tipo, mensagem) {
  const el = $(sel);
  el.className = `alert alert-${tipo}`;
  el.innerHTML = `<span class="material-symbols-outlined me-1" style="font-size:1.1rem">${tipo === 'success' ? 'check_circle' : 'error'}</span>${esc(mensagem)}`;
}

function criarAlerta() {
  const div = document.createElement('div');
  div.id = 'alerta';
  div.className = 'd-none';
  $('#formSolicitar').parentElement.insertBefore(div, $('#formSolicitar'));
  return div;
}

const $alerta = criarAlerta();

/* ------------------------------------------------------------
   Força da senha
   ------------------------------------------------------------ */
function forcaSenha(valor) {
  let pontos = 0;
  if (valor.length >= 8) pontos++;
  if (valor.length >= 12) pontos++;
  if (/[a-z]/.test(valor) && /[A-Z]/.test(valor)) pontos++;
  if (/\d/.test(valor)) pontos++;
  if (/[^A-Za-z0-9]/.test(valor)) pontos++;
  const niveis = [
    { nome: 'muito fraca', cor: '#dc3545', pct: 15 },
    { nome: 'fraca', cor: '#e67e22', pct: 35 },
    { nome: 'razoável', cor: '#f1c40f', pct: 55 },
    { nome: 'boa', cor: '#8e44ad', pct: 78 },
    { nome: 'forte', cor: '#16a085', pct: 100 }
  ];
  return niveis[Math.max(0, Math.min(4, pontos - 1))];
}

function mostrarForca() {
  const valor = $('#novaSenha').value;
  const box = $('#forcaSenha');
  if (!valor) { box.innerHTML = ''; return; }
  const n = forcaSenha(valor);
  box.innerHTML = `
    <div class="progress" style="height:.4rem">
      <div class="progress-bar" style="width:${n.pct}%;background:${n.cor}"></div>
    </div>
    <small class="text-muted">Senha ${n.nome}. Use no mínimo 8 caracteres, com letras e números.</small>`;
}

/* ------------------------------------------------------------
   Alternar visibilidade da senha
   ------------------------------------------------------------ */
$('#btnVer1').addEventListener('click', () => {
  const campo = $('#novaSenha');
  const mostrando = campo.type === 'text';
  campo.type = mostrando ? 'password' : 'text';
  $('#btnVer1 .material-symbols-outlined').textContent = mostrando ? 'visibility' : 'visibility_off';
});

$('#novaSenha').addEventListener('input', mostrarForca);

/* ------------------------------------------------------------
   Etapa 1: solicitar o link por e-mail
   ------------------------------------------------------------ */
$('#formSolicitar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btnSolicitar');
  const email = $('#email').value.trim();
  if (!email) return;

  $alerta.className = 'd-none';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';

  try {
    const r = await api('/api/auth/recuperar-senha', { method: 'POST', body: { email } });
    btn.innerHTML = '<span class="material-symbols-outlined me-1">send</span> Enviar link de recuperação';
    alerta('#alerta', 'success', r.mensagem);
    if (r.envio && r.envio.transporte === 'console') {
      alerta('#alerta', 'warning',
        `${r.mensagem} O servidor não está com SMTP configurado: verifique o link impresso no console do servidor.`);
    }
    btn.disabled = false;
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined me-1">send</span> Enviar link de recuperação';
    alerta('#alerta', 'danger', err.message);
  }
});

/* ------------------------------------------------------------
   Etapa 2: cadastrar a nova senha
   ------------------------------------------------------------ */
$('#formNovaSenha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btnSalvar');
  const novaSenha = $('#novaSenha').value;
  const confirma = $('#confirmaSenha').value;
  const token = new URLSearchParams(location.search).get('token');

  if (novaSenha !== confirma) {
    alerta('#alerta', 'danger', 'As senhas informadas não são iguais.');
    return;
  }

  $alerta.className = 'd-none';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Salvando...';

  try {
    await api('/api/auth/redefinir-senha', { method: 'POST', body: { token, novaSenha } });
    $('#etapaSolicitar').classList.add('d-none');
    $('#etapaNovaSenha').classList.add('d-none');
    $('#etapaConcluido').classList.remove('d-none');
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined me-1">key</span> Salvar nova senha';
    alerta('#alerta', 'danger', err.message);
    if (err.status === 400) {
      $('#novaSenha').value = '';
      $('#confirmaSenha').value = '';
      mostrarForca();
    }
  }
});

/* ------------------------------------------------------------
   Inicialização: veio de um link com token?
   ------------------------------------------------------------ */
(async function iniciar() {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) return;

  $('#etapaSolicitar').classList.add('d-none');
  $('#etapaNovaSenha').classList.remove('d-none');

  try {
    const r = await api('/api/auth/validar-token', { method: 'POST', body: { token } });
    $('#destinatario').innerHTML =
      `Link válido para <strong>${esc(r.nome)}</strong> &middot; ${esc(r.usuario)} &middot; ${esc(r.email)}`;
    $('#novaSenha').focus();
  } catch (err) {
    $('#etapaNovaSenha').classList.add('d-none');
    $('#etapaSolicitar').classList.remove('d-none');
    alerta('#alerta', 'danger', `${err.message} Informe o e-mail para receber um novo link.`);
  }
})();
