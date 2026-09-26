/* ============================================================
   Confeitaria ERP - Frontend (Ajax / Fetch)
   ============================================================ */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const qtd = (v, inteiro) => inteiro
  ? Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  : num(v);
const dataBR = v => v ? String(v).split('T')[0].split('-').reverse().join('/') : '-';
const hoje = () => new Date().toISOString().split('T')[0];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Erro de API com o status HTTP preservado (o router usa 401 para voltar ao login)
function erroApi(data, status) {
  const e = new Error(data.erro || 'Erro na requisição.');
  e.status = status;
  e.motivo = data.motivo || null;
  e.restantes = data.restantes;
  return e;
}

async function api(url, { method = 'GET', body } = {}) {
  const resp = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw erroApi(data, resp.status);
  return data;
}

// Requisição multipart (upload de arquivos)
async function apiForm(url, form, method = 'POST') {
  const resp = await fetch(url, { method, body: form });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw erroApi(data, resp.status);
  return data;
}

function toast(msg, tipo = 'success') {
  const el = document.createElement('div');
  el.className = `toast-custom ${tipo} mb-2`;
  el.innerHTML = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2800);
  setTimeout(() => el.remove(), 3200);
}

function openModal(html) {
  const c = $('#modal-container');
  c.innerHTML = html;
  const m = $('.modal', c);
  if (!m) return null;
  const inst = new bootstrap.Modal(m);
  m.addEventListener('hidden.bs.modal', () => { c.innerHTML = ''; });
  inst.show();
  return inst;
}

function closeModal() {
  const m = $('#modal-container .modal');
  if (m) bootstrap.Modal.getInstance(m)?.hide();
}

function formData(formId) {
  const f = $(`#${formId}`);
  const obj = {};
  $$('input, select, textarea', f).forEach(el => {
    if (el.name) obj[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return obj;
}

/* ---------- Cache de opções ---------- */
const cache = {};
async function opcoesMedidas() {
  if (!cache.medidas) cache.medidas = await api('/api/medidas');
  return cache.medidas;
}
async function opcoesInsumos() {
  if (!cache.insumos) cache.insumos = await api('/api/insumos');
  return cache.insumos;
}
async function opcoesReceitas() {
  if (!cache.receitas) cache.receitas = await api('/api/receitas');
  return cache.receitas;
}
function invalidarCache() { delete cache.medidas; delete cache.insumos; delete cache.receitas; }

const selectInsumos = (insumos, sel = '') =>
  `<option value="">Selecione o insumo...</option>` +
  insumos.map(i => `<option value="${i.id}" data-inteiro="${i.medida_inteiro ? 1 : 0}" ${sel == i.id ? 'selected' : ''}>${esc(i.produto)}</option>`).join('');

const selectMedidas = (medidas, sel = '') =>
  `<option value="">-</option>` +
  medidas.map(m => `<option value="${m.id}" data-inteiro="${m.inteiro ? 1 : 0}" ${sel == m.id ? 'selected' : ''}>${esc(m.descricao)}</option>`).join('');

const selectReceitas = (receitas, sel = '') =>
  `<option value="">Selecione a receita...</option>` +
  receitas.map(r => `<option value="${r.id}" ${sel == r.id ? 'selected' : ''}>${esc(r.nome)}</option>`).join('');

// Ajusta o campo de quantidade conforme a medida do item selecionado:
// - inteiro (ex.: unidade)  → step 1, min 1, sem casas decimais
// - outras medidas          → step 0.001
function sincInteiro(sel, qIn) {
  const q = qIn instanceof Element ? qIn : $(qIn);
  if (!q) return;
  const opt = sel.options[sel.selectedIndex];
  const inteiro = opt && opt.dataset.inteiro === '1';
  q.step = inteiro ? '1' : '0.001';
  q.min = inteiro ? '1' : '0.001';
  if (inteiro && q.value !== '' && !Number.isInteger(Number(q.value))) {
    q.value = Math.round(Number(q.value));
  }
}

/* objeto global das ações chamado pelos botões (onclick) */
window.App = window.App || {};

/* ============================================================
   SESSÃO E PERMISSÕES
   ============================================================ */
let SESSAO = null;

const iniciais = nome => String(nome || '?')
  .trim().split(/\s+/).slice(0, 2)
  .map(p => p[0]).join('').toUpperCase();

// Avatar: usa a foto cadastrada ou as iniciais do nome
function avatarHtml(usuario, tamanho = 'avatar-sm') {
  if (usuario && usuario.foto_url) {
    return `<span class="avatar ${tamanho}"><img src="${esc(usuario.foto_url)}" alt=""></span>`;
  }
  return `<span class="avatar ${tamanho}">${esc(iniciais(usuario && usuario.nome))}</span>`;
}

function temPermissao(chave) {
  if (!SESSAO) return false;
  if (SESSAO.acesso_total) return true;
  return Array.isArray(SESSAO.permissoes) && SESSAO.permissoes.includes(chave);
}

// esconde do menu as telas sem permissão
function aplicarPermissoesNoMenu() {
  const visiveis = new Set();
  $$('.sidebar-nav .nav-link[data-perm]').forEach(a => {
    const ok = temPermissao(a.dataset.perm);
    a.classList.toggle('d-none', !ok);
    if (ok) visiveis.add(a.dataset.perm.split('.')[0]);
  });
  const sepSeguranca = $('.nav-separator[data-seg="seguranca"]');
  if (sepSeguranca) {
    const algum = ['usuarios', 'grupos', 'perfis', 'auditoria'].some(m => visiveis.has(m));
    sepSeguranca.classList.toggle('d-none', !algum);
  }
  // esconde botões de cadastro quando o usuário só pode visualizar
  $$('#content [data-perm-acao]').forEach(b => {
    b.classList.toggle('d-none', !temPermissao(b.dataset.permAcao));
  });
}

function pinturaTopbar() {
  const u = SESSAO;
  if (!u) return;
  const alvo = $('#topbarAvatar');
  if (alvo) alvo.outerHTML = avatarHtml(u, 'avatar-sm').replace('<span class="avatar', '<span id="topbarAvatar" class="avatar');
  $('#btnUsuario').title = `${u.nome} (${u.usuario})`;
  $('#menuNome').textContent = u.nome;
  $('#menuLogin').textContent = u.usuario + (u.cargo ? ` · ${u.cargo}` : '');
  $('#menuGrupos').innerHTML = u.grupos.length
    ? u.grupos.map(g => `<span class="badge text-bg-light me-1">${esc(g.nome)}</span>`).join('') +
      (u.acesso_total ? '<span class="badge text-bg-primary">acesso total</span>' : '')
    : '<span class="badge text-bg-light">sem grupo</span>';
}

function irParaLogin(motivo) {
  location.replace(motivo ? `/login.html?${motivo}` : '/login.html');
}

/* ============================================================
   ROUTER
   ============================================================ */
const TITULOS = {
  dashboard: 'Dashboard',
  clientes: 'Clientes',
  campanhas: 'Campanhas',
  medidas: 'Medidas',
  insumos: 'Insumos',
  receitas: 'Receitas Prontas',
  precificacao: 'Precificação',
  caixa: 'Fluxo de Caixa',
  relatorios: 'Relatórios',
  usuarios: 'Usuários',
  grupos: 'Grupos de Usuários',
  perfis: 'Perfis de Acesso',
  auditoria: 'Auditoria',
  'meu-perfil': 'Meu Perfil',
  sessoes: 'Minhas Sessões'
};

// tela -> permissão exigida (ausente = qualquer usuário autenticado)
const PERMISSAO_ROTA = {
  dashboard: 'dashboard.ver',
  clientes: 'clientes.ver',
  campanhas: 'campanhas.ver',
  medidas: 'medidas.ver',
  insumos: 'insumos.ver',
  receitas: 'receitas.ver',
  precificacao: 'precificacao.ver',
  caixa: 'caixa.ver',
  relatorios: 'relatorios.ver',
  usuarios: 'usuarios.ver',
  grupos: 'grupos.ver',
  perfis: 'perfis.ver',
  auditoria: 'auditoria.ver'
};

const rotas = {
  dashboard, clientes, campanhas, medidas, insumos, receitas, precificacao, caixa, relatorios,
  usuarios, grupos, perfis, auditoria,
  'meu-perfil': meuPerfil, sessoes: minhasSessoes
};

// primeira tela do menu à qual o usuário tem acesso
function primeiraRotaPermitida() {
  const link = $$('.sidebar-nav .nav-link').find(a => !a.classList.contains('d-none'));
  return link ? link.dataset.rota : null;
}

async function rotear() {
  const nome = (location.hash.replace(/^#\//, '').split('?')[0]) || 'dashboard';
  const fn = rotas[nome];

  if (!fn) {
    location.hash = '#/dashboard';
    return;
  }
  if (PERMISSAO_ROTA[nome] && !temPermissao(PERMISSAO_ROTA[nome])) {
    // tela inicial sem permissão: abre a primeira tela liberada do menu
    const alternativa = primeiraRotaPermitida();
    if (nome === 'dashboard' && alternativa && alternativa !== nome && rotas[alternativa] &&
        (!PERMISSAO_ROTA[alternativa] || temPermissao(PERMISSAO_ROTA[alternativa]))) {
      location.hash = `#/${alternativa}`;
      return;
    }
    // tela digitada na URL: informa o bloqueio em vez de redirecionar
    $('#pageTitle').textContent = 'Acesso negado';
    $('#content').innerHTML = `
      <div class="card-crud">
        <div class="card-body text-center py-5">
          <span class="material-symbols-outlined" style="font-size:3rem;color:#dc3545">lock</span>
          <h5 class="mt-3">Você não tem permissão para acessar esta tela</h5>
          <p class="text-muted small mb-3">Peça a um administrador para liberar o acesso em Perfis de Acesso.</p>
          ${alternativa
            ? `<a href="#/${alternativa}" class="btn btn-outline-primary btn-sm">Ir para ${esc(TITULOS[alternativa])}</a>`
            : '<p class="text-muted small mb-0">Nenhuma tela liberada para este usuário. Fale com o administrador.</p>'}
        </div>
      </div>`;
    return;
  }

  $$('.sidebar-nav .nav-link').forEach(a => a.classList.toggle('active', a.dataset.rota === nome));
  $('#pageTitle').textContent = TITULOS[nome] || 'Dashboard';
  const sec = $('#content');
  sec.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="spinner-border text-primary-sys" role="status"></div></div>';
  try {
    await fn();
    aplicarPermissoesNoMenu();
  } catch (e) {
    if (e.status === 401) return irParaLogin(e.motivo === 'bloqueado' ? 'bloqueado' : 'expirada');
    sec.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', rotear);

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const r = await api('/api/auth/me');
    SESSAO = r.usuario;
  } catch (e) {
    if (e.status === 401) return irParaLogin(e.motivo === 'bloqueado' ? 'bloqueado' : '');
    return;
  }

  aplicarPermissoesNoMenu();
  pinturaTopbar();
  $('#btnSidebar')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $$('.sidebar-nav .nav-link').forEach(a => a.addEventListener('click', () => $('#sidebar').classList.remove('open')));
  const relogio = $('#clock');
  const tick = () => {
    relogio.textContent = new Date().toLocaleString('pt-BR');
  };
  setInterval(tick, 1000);
  tick();
  await rotear();
  if (SESSAO.deve_alterar_senha) window.App.exigirTrocaSenha();
});

/* ============================================================
   SESSÃO: sair e troca obrigatória de senha
   ============================================================ */
window.App.sair = async () => {
  try { await api('/api/auth/sair', { method: 'POST' }); } catch (e) { /* encerra assim mesmo */ }
  location.replace('/login.html');
};

window.App.irParaMeuPerfil = () => { location.hash = '#/meu-perfil'; };

// Modal que não pode ser dispensado (troca de senha obrigatória)
window.App.exigirTrocaSenha = () => {
  if ($('#modalTrocaObrigatoria')) return;
  openModal(`
    <div class="modal fade" id="modalTrocaObrigatoria" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <span class="material-symbols-outlined me-1" style="color:var(--principal)">key</span>
              Defina uma nova senha
            </h5>
          </div>
          <div class="modal-body">
            <p class="text-muted small">
              Por segurança, a senha inicial deve ser trocada antes de continuar usando o sistema.
            </p>
            <form id="formTrocaForcada" class="row g-3">
              <div class="col-12"><label class="form-label">Senha atual *</label>
                <input name="senhaAtual" type="password" class="form-control" autocomplete="current-password" required></div>
              <div class="col-md-6"><label class="form-label">Nova senha *</label>
                <input name="novaSenha" type="password" class="form-control" autocomplete="new-password" required></div>
              <div class="col-md-6"><label class="form-label">Repetir a nova senha *</label>
                <input name="confirma" type="password" class="form-control" autocomplete="new-password" required></div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" type="button" onclick="App.sair()">Sair do sistema</button>
            <button class="btn btn-primary" type="button" onclick="App.salvarTrocaForcada()">Salvar nova senha</button>
          </div>
        </div>
      </div>
    </div>`);
  $('#modalTrocaObrigatoria').querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => {
    if (e.key === 'Enter') window.App.salvarTrocaForcada();
  }));
};

window.App.salvarTrocaForcada = async () => {
  const b = formData('formTrocaForcada');
  if (!b.senhaAtual || !b.novaSenha) return toast('Preencha todos os campos.', 'danger');
  if (b.novaSenha !== b.confirma) return toast('As senhas informadas não são iguais.', 'danger');
  try {
    await api('/api/auth/alterar-senha', { method: 'POST', body: { senhaAtual: b.senhaAtual, novaSenha: b.novaSenha } });
    SESSAO.deve_alterar_senha = false;
    toast('Senha alterada com sucesso.');
    $('#modal-container').innerHTML = '';
  } catch (e) { toast(esc(e.message), 'danger'); }
};

/* ============================================================
   DASHBOARD
   ============================================================ */
async function dashboard() {
  const d = await api('/api/dashboard');
  const stat = (icon, cor, label, valor) => `
    <div class="col-12 col-sm-6 col-md-4 col-xl-2">
      <div class="stat-card d-flex align-items-center gap-3">
        <div class="icon" style="background:${cor}"><span class="material-symbols-outlined">${icon}</span></div>
        <div class="lh-1">
          <div class="valor mb-1">${valor}</div>
          <div class="text-muted small">${label}</div>
        </div>
      </div>
    </div>`;

  const recentCard = (titulo, icon, cor, itens, rota, contagem) => `
    <div class="col-12 col-md-6 col-xl-4">
      <div class="recent-card">
        <h6><span class="material-symbols-outlined" style="color:${cor}">${icon}</span> ${titulo}
          <span class="badge text-bg-light ms-1">${contagem}</span></h6>
        <ul class="list-group list-group-flush flex-grow-1">
          ${itens.length
            ? itens.map(i => `<li class="list-group-item d-flex justify-content-between align-items-center gap-2">
                <span class="text-truncate">${esc(i.titulo)}</span>
                <span class="data text-nowrap">${dataBR(i.created_at)}</span>
              </li>`).join('')
            : '<li class="list-group-item text-muted">Nenhum registro ainda.</li>'}
        </ul>
        <div class="mt-2">
          <a href="#/${rota}" class="btn btn-sm btn-outline-primary">Ver mais <span class="material-symbols-outlined ms-1" style="font-size:1rem">arrow_forward</span></a>
        </div>
      </div>
    </div>`;

  const r = d.recentes;
  $('#content').innerHTML = `
    <div class="row g-3">
      ${stat('people', '#4a7cc7', 'Clientes', d.totais.clientes)}
      ${stat('campaign', '#e67e22', 'Campanhas', d.totais.campanhas)}
      ${stat('inventory_2', '#16a085', 'Insumos', d.totais.insumos)}
      ${stat('menu_book', '#8e44ad', 'Receitas', d.totais.receitas)}
      ${stat('sell', '#2c3e50', 'Precificação', d.totais.precificacao)}
      ${stat('account_balance_wallet', '#27ae60', 'Saldo caixa', money(d.totais.saldo_caixa))}
    </div>
    <div class="alert alert-light border small">
      <span class="material-symbols-outlined" style="font-size:1rem">info</span>
      Os custos de receitas e precificações são recalculados automaticamente sempre que um insumo tem o valor alterado.
    </div>
    <h6 class="text-uppercase fw-bold text-muted small">Últimos itens adicionados</h6>
    <div class="row g-3">
      ${recentCard('Clientes', 'people', '#4a7cc7', r.clientes, 'clientes', d.totais.clientes)}
      ${recentCard('Campanhas', 'campaign', '#e67e22', r.campanhas, 'campanhas', d.totais.campanhas)}
      ${recentCard('Insumos', 'inventory_2', '#16a085', r.insumos, 'insumos', d.totais.insumos)}
      ${recentCard('Receitas Prontas', 'menu_book', '#8e44ad', r.receitas, 'receitas', d.totais.receitas)}
      ${recentCard('Precificação', 'sell', '#2c3e50', r.precificacao, 'precificacao', d.totais.precificacao)}
    </div>`;
}

/* ============================================================
   CLIENTES
   ============================================================ */
async function clientes() {
  const dados = await api('/api/clientes');
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <input class="form-control form-control-sm search-control" id="filtro" placeholder="Buscar...">
        <button class="btn btn-primary btn-sm" data-perm-acao="clientes.editar" onclick="App.novoCliente()"><span class="material-symbols-outlined">add</span> Novo Cliente</button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr>
            <th>Nome</th><th>CPF/CNPJ</th><th>Telefone</th><th>WhatsApp</th><th>E-mail</th>
            <th>Endereço</th><th>CEP</th><th>Cadastrado</th><th class="text-end">Ações</th>
          </tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>`;

  const tbody = $('#tbody');
  const linha = c => `
    <tr>
      <td><strong>${esc(c.nome)}</strong></td>
      <td>${esc(c.cpf_cnpj || '-')}</td>
      <td>${esc(c.telefone || '-')}</td>
      <td><span class="badge ${c.whatsapp ? 'text-bg-success' : 'text-bg-secondary'} badge-whats">${c.whatsapp ? 'Sim' : 'Não'}</span>${c.desabilitar_whatsapp ? '<span class="badge text-bg-danger ms-1">Campanhas desabilitadas</span>' : ''}</td>
      <td>${esc(c.email || '-')}</td>
      <td>${esc([c.endereco, c.bairro].filter(Boolean).join(' - ') || '-')}</td>
      <td>${esc(c.cep || '-')}</td>
      <td class="text-muted small">${dataBR(c.created_at)}</td>
      <td class="text-end actions text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirCliente(${c.id})" title="Editar"><span class="material-symbols-outlined">edit</span></button>
        <button class="btn btn-sm btn-outline-danger" onclick="App.excluirCliente(${c.id})" title="Excluir"><span class="material-symbols-outlined">delete</span></button>
      </td>
    </tr>`;

  tbody.innerHTML = dados.length ? dados.map(linha).join('') :
    '<tr><td colspan="9" class="text-center text-muted py-4">Nenhum cliente cadastrado.</td></tr>';

  $('#filtro').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filt = dados.filter(c => [c.nome, c.cpf_cnpj, c.telefone, c.email, c.endereco, c.bairro, c.cep]
      .some(v => (v || '').toLowerCase().includes(q)));
    tbody.innerHTML = filt.length ? filt.map(linha).join('') :
      '<tr><td colspan="9" class="text-center text-muted py-4">Nenhum cliente encontrado.</td></tr>';
  });

  window.App.novoCliente = async () => {
    openModal(htmlFormCliente(null));
  };
  window.App.abrirCliente = async (id) => {
    const c = await api(`/api/clientes/${id}`);
    openModal(htmlFormCliente(c));
  };
  window.App.salvarCliente = async (id) => {
    const b = formData('formCliente');
    b.whatsapp = b.whatsapp === '1' || b.whatsapp === true;
    b.desabilitar_whatsapp = b.desabilitar_whatsapp === true;
    try {
      id
        ? await api(`/api/clientes/${id}`, { method: 'PUT', body: b })
        : await api('/api/clientes', { method: 'POST', body: b });
      closeModal();
      toast('Cliente salvo com sucesso.');
      clientes();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
  window.App.excluirCliente = async (id) => {
    if (!confirm('Excluir este cliente?')) return;
    try {
      await api(`/api/clientes/${id}`, { method: 'DELETE' });
      toast('Cliente excluído.');
      clientes();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
}

function htmlFormCliente(c) {
  const id = c ? c.id : null;
  const v = field => c ? esc(c[field] ?? '') : '';
  const whats = (c ? Number(c.whatsapp) : 1) === 1 ? '1' : '0';
  const desabilitarWhatsapp = c ? Number(c.desabilitar_whatsapp) === 1 : false;
  return `
  <div class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${id ? 'Editar Cliente' : 'Novo Cliente'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="formCliente" class="row g-3">
            <div class="col-12"><label class="form-label">Nome *</label>
              <input name="nome" class="form-control" value="${v('nome')}" required></div>
            <div class="col-md-6"><label class="form-label">CPF/CNPJ</label>
              <input name="cpf_cnpj" class="form-control" value="${v('cpf_cnpj')}"></div>
            <div class="col-md-6"><label class="form-label">Telefone</label>
              <input name="telefone" class="form-control" value="${v('telefone')}"></div>
            <div class="col-md-6"><label class="form-label">WhatsApp</label>
              <select name="whatsapp" class="form-select">
                <option value="1" ${whats === '1' ? 'selected' : ''}>Sim</option>
                <option value="0" ${whats === '0' ? 'selected' : ''}>Não</option>
              </select></div>
            <div class="col-md-6"><label class="form-label">E-mail</label>
              <input name="email" class="form-control" value="${v('email')}"></div>
            <div class="col-12 form-check form-switch">
              <input class="form-check-input" type="checkbox" role="switch" id="clienteDesabilitarWhatsapp" name="desabilitar_whatsapp" ${desabilitarWhatsapp ? 'checked' : ''}>
              <label class="form-check-label" for="clienteDesabilitarWhatsapp">
                <strong>Desabilitar WhatsApp</strong>
                <span class="d-block small text-muted">Não enviar campanhas via WhatsApp para este cliente.</span>
              </label>
            </div>
            <div class="col-md-8"><label class="form-label">Endereço</label>
              <input name="endereco" class="form-control" value="${v('endereco')}"></div>
            <div class="col-6 col-md-4"><label class="form-label">Bairro</label>
              <input name="bairro" class="form-control" value="${v('bairro')}"></div>
            <div class="col-6 col-md-4"><label class="form-label">CEP</label>
              <input name="cep" class="form-control" value="${v('cep')}"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" onclick="App.salvarCliente(${id ?? ''})">Salvar</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   CAMPANHAS
   ============================================================ */
async function campanhas() {
  const dados = await api('/api/campanhas');
  $('#content').innerHTML = `
    <div class="row g-3">
      <div class="col-md-8">
        <div class="card-crud card h-100">
          <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span class="text-muted small">${dados.length} campanha(s) cadastrada(s)</span>
            <button class="btn btn-primary btn-sm" data-perm-acao="campanhas.editar" onclick="App.novaCampanha()"><span class="material-symbols-outlined">add</span> Nova Campanha</button>
          </div>
          <div class="table-responsive">
            <table class="table table-sm table-hover table-crud mb-0">
              <thead><tr><th>Nome</th><th>Descrição</th><th>Período</th><th>Arquivo</th><th class="text-end">Ações</th></tr></thead>
              <tbody id="tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card-crud card">
          <div class="card-header"><strong>WhatsApp Web</strong></div>
          <div class="card-body" id="waCard">
            <div class="small text-muted">Verificando conexão...</div>
          </div>
        </div>
        <div id="envioStatus"></div>
      </div>
    </div>
    <div class="alert alert-light border small" style="background:#fafafa">
      <span class="material-symbols-outlined" style="font-size:1rem">info</span>
      O arquivo anexado é salvo como <code>AAAA-MM-DD-Campanha-nome-da-campanha.ext</code>.
      Ao enviar por WhatsApp, a imagem/PDF + a descrição são enviados aos clientes com WhatsApp = Sim e campanhas habilitadas, em fila com intervalos e pausas automáticas.
    </div>`;

  const tbody = $('#tbody');
  const tipofile = a => {
    if (!a) return '-';
    const ext = a.split('.').pop().toLowerCase();
    const icone = ['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(ext) ? 'image' : 'picture_as_pdf';
    return `<span class="badge text-bg-light border">${esc(ext.toUpperCase())}</span>`;
  };
  tbody.innerHTML = dados.length ? dados.map(c => `
    <tr>
      <td><strong>${esc(c.nome)}</strong></td>
      <td class="text-muted small" style="max-width:220px">${esc((c.descricao || '-').slice(0, 80))}</td>
      <td class="small">${dataBR(c.data_inicio)}${c.data_termino ? ' → ' + dataBR(c.data_termino) : ''}</td>
      <td>${c.arquivo
        ? `<a href="${esc(c.arquivo_url)}" target="_blank" class="badge text-bg-light border text-decoration-none">${tipofile(c.arquivo)} ${esc(c.arquivo.split('-').pop())}</a>`
        : '-'}</td>
      <td class="text-end actions text-nowrap">
        ${c.arquivo ? `<button class="btn btn-sm btn-outline-success" onclick="App.enviarCampanha(${c.id})" title="Enviar WhatsApp"><span class="material-symbols-outlined">send</span></button>` : ''}
        <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirCampanha(${c.id})"><span class="material-symbols-outlined">edit</span></button>
        <button class="btn btn-sm btn-outline-danger" onclick="App.excluirCampanha(${c.id})"><span class="material-symbols-outlined">delete</span></button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="text-center text-muted py-4">Nenhuma campanha cadastrada.</td></tr>';

  renderWaStatus();

  window.App.novaCampanha = () => openModal(htmlFormCampanha(null));
  window.App.abrirCampanha = async (id) => {
    const c = await api(`/api/campanhas/${id}`);
    openModal(htmlFormCampanha(c));
  };
  window.App.salvarCampanha = async (id) => {
    const f = new FormData();
    const b = formData('formCampanha');
    f.append('nome', b.nome);
    f.append('descricao', b.descricao || '');
    f.append('data_inicio', b.data_inicio);
    f.append('data_termino', b.data_termino || '');
    const arq = $('#formCampanha [name=arquivo]').files[0];
    if (arq) f.append('arquivo', arq);
    try {
      const r = id
        ? await apiForm(`/api/campanhas/${id}`, f, 'PUT')
        : await apiForm('/api/campanhas', f);
      closeModal();
      toast('Campanha salva com sucesso.');
      campanhas();
      if (!id && r.arquivo && r.clientes_whatsapp > 0) {
        if (confirm(`Enviar esta campanha para ${r.clientes_whatsapp} cliente(s) com WhatsApp = Sim e campanhas habilitadas?\n\nA imagem/PDF e a descrição serão enviados automaticamente.`)) {
          App.enviarCampanha(r.id);
        } else {
          toast('Campanha salva sem envio.', 'danger');
        }
      }
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
  window.App.excluirCampanha = async (id) => {
    if (!confirm('Excluir esta campanha? O arquivo anexado também será removido.')) return;
    try {
      await api(`/api/campanhas/${id}`, { method: 'DELETE' });
      toast('Campanha excluída.');
      campanhas();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
  window.App.enviarCampanha = async (id) => {
    try {
      const r = await api(`/api/campanhas/${id}/enviar`, { method: 'POST' });
      toast(r.mensagem);
      pollEnvio(id);
    } catch (e) {
      if (String(e.message).toLowerCase().includes('whatsapp web não está conectado')) {
        const ok = confirm('WhatsApp Web ainda não está conectado. Deseja abrir o QR Code para conectar agora?');
        if (ok) abrirQrWhats();
        else toast(esc(e.message), 'danger');
      } else {
        toast(esc(e.message), 'danger');
      }
    }
  };
  window.App.conectarWhats = abrirQrWhats;
}

function htmlFormCampanha(c) {
  const id = c ? c.id : null;
  const v = f => c ? esc(c[f] ?? '') : '';
  const temArquivo = c && c.arquivo;
  return `
  <div class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${id ? 'Editar Campanha' : 'Nova Campanha'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="formCampanha" class="row g-3">
            <div class="col-12"><label class="form-label">Nome *</label>
              <input name="nome" class="form-control" value="${v('nome')}" placeholder="Ex.: Páscoa 2026" required></div>
            <div class="col-12"><label class="form-label">Descrição</label>
              <textarea name="descricao" class="form-control" rows="3">${v('descricao')}</textarea>
              <small class="text-muted">Este texto é enviado junto com a imagem no WhatsApp.</small></div>
            <div class="col-md-6"><label class="form-label">Data de início *</label>
              <input name="data_inicio" type="date" class="form-control" value="${v('data_inicio')}" required></div>
            <div class="col-md-6"><label class="form-label">Data de término</label>
              <input name="data_termino" type="date" class="form-control" value="${v('data_termino')}"></div>
            <div class="col-12">
              <label class="form-label">Arquivo <span class="text-muted small">(PDF, JPG, PNG, SVG ou GIF)</span></label>
              <input type="file" name="arquivo" class="form-control" accept=".pdf,.jpg,.jpeg,.png,.svg,.gif">
              ${temArquivo ? `<small class="text-muted d-block mt-1">Arquivo atual: <a href="${esc(c.arquivo_url)}" target="_blank">${esc(c.arquivo)}</a>. Envie outro para substituir.</small>` : ''}
              <small class="text-muted d-block mt-1">Será salvo como <code>AAAA-MM-DD-Campanha-nome-da-campanha.ext</code></small>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" onclick="App.salvarCampanha(${id ?? ''})">Salvar</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ---- WhatsApp Web: status, QR e progresso do envio ---- */
const WA_LABEL = {
  disabled: ['Cinza', 'WhatsApp desativado'],
  disconnected: ['warning', 'Desconectado'],
  loading: ['info', 'Carregando...'],
  qr: ['primary', 'Aguardando QR Code'],
  authenticated: ['info', 'Autenticado'],
  ready: ['success', 'Conectado'],
  auth_failure: ['danger', 'Falha de autenticação'],
  error: ['danger', 'Erro interno']
};

async function renderWaStatus() {
  const el = $('#waCard');
  if (!el) return;
  try {
    const s = await api('/api/whatsapp/status');
    const [cor, lbl] = WA_LABEL[s.status] || WA_LABEL.disconnected;
    el.innerHTML = `
      <div class="d-flex align-items-center gap-2 mb-2">
        <span class="badge text-bg-${cor}">${lbl}</span>
      </div>
      ${s.status === 'ready'
        ? `<small class="text-muted">Conectado ao WhatsApp Web${s.ultimaConexao ? ' desde ' + new Date(s.ultimaConexao).toLocaleTimeString('pt-BR') : ''}.</small>`
        : `<small class="text-muted">O envio automático exige o WhatsApp Web conectado com uma conta real.</small>`}
      <div class="mt-2">
        <button class="btn btn-sm ${s.status === 'qr' ? 'btn-primary' : 'btn-outline-primary'}"
          onclick="App.conectarWhats()">${s.status === 'ready' ? 'Ver QR' : 'Conectar WhatsApp'}</button>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="small text-danger">${esc(e.message)}</div>`;
  }
}

async function abrirQrWhats() {
  openModal(`
    <div class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Conectar WhatsApp Web</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body text-center">
            <div id="qrArea"><div class="spinner-border text-primary-sys" role="status"></div></div>
            <p class="small text-muted mt-2">Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho e escaneie o QR.</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
          </div>
        </div>
      </div>
    </div>`);
  const qrArea = $('#qrArea');
  if (!qrArea) return;
  const iv = setInterval(async () => {
    try {
      const st = await api('/api/whatsapp/status');
      if (st.status === 'ready') {
        clearInterval(iv);
        qrArea.innerHTML = `<div class="text-success fs-5">WhatsApp conectado com sucesso!</div>`;
        renderWaStatus();
        setTimeout(closeModal, 1200);
        return;
      }
      if (st.status === 'auth_failure') {
        clearInterval(iv);
        qrArea.innerHTML = `<div class="text-danger">Falha na autenticação. Tente novamente.</div>`;
        return;
      }
      if (st.status === 'qr') {
        const d = await api('/api/whatsapp/qr').catch(() => null);
        if (d) qrArea.innerHTML = `
          <img src="${d.qr}" alt="QR Code" class="img-fluid rounded border" style="max-width:260px">
          <p class="small text-muted mt-2">QR atualiza em alguns segundos. Mantenha aberto.</p>`;
      } else {
        qrArea.innerHTML = `<div class="small text-muted">Status: ${WA_LABEL[st.status] ? WA_LABEL[st.status][1] : st.status} ...</div>`;
      }
    } catch (e) {
      qrArea.innerHTML = `<div class="small text-danger">${esc(e.message)}</div>`;
    }
  }, 3000);
}

async function pollEnvio(id) {
  const el = $('#envioStatus');
  if (!el) return;
  let primeira = true;
  const iv = setInterval(async () => {
    try {
      const s = await api(`/api/campanhas/${id}/envio/status`);
      if (!s.ativo && primeira) { primeira = false; }
      const pct = s.percentual ?? 0;
      const cores = pct === 100 ? 'bg-success' : 'bg-info';
      el.innerHTML = `
        <div class="card-crud card mt-3">
          <div class="card-body py-3">
            <div class="d-flex justify-content-between mb-1 small">
              <strong>Envio via WhatsApp ${s.concluido ? '(' + (s.cancelado ? 'cancelado' : 'concluído') + ')' : 'em andamento...'}</strong>
              <span>${s.enviados} / ${s.total} enviadas</span>
            </div>
            <div class="progress" style="height:18px">
              <div class="progress-bar ${cores}" style="width:${pct}%">${pct}%</div>
            </div>
            <div class="mt-1 small text-muted">
              ${s.totalCadastro ? `Ativo de ${s.totalCadastro} número(s) de clientes com WhatsApp = Sim.` : ''}
              ${s.falhas && s.falhas.length ? ` ${s.falhas.length} falha(s).` : ''}
            </div>
            ${s.falhas && s.falhas.length ? `<details class="mt-1"><summary class="small text-danger">Detalhes das falhas</summary>
              <ul class="small">${s.falhas.slice(0, 20).map(f => `<li>${esc(f.numero)} — ${esc(f.erro)}</li>`).join('')}</ul></details>` : ''}
            ${!s.concluido ? `<div class="mt-2"><button class="btn btn-outline-danger btn-sm" onclick="App.cancelarEnvio(${id})">Cancelar envio</button></div>` : ''}
          </div>
        </div>`;
      if (s.concluido) clearInterval(iv);
    } catch (e) {
      clearInterval(iv);
      el.innerHTML = `<div class="alert alert-danger mt-3 small">Erro ao consultar o envio: ${esc(e.message)}</div>`;
    }
  }, 2000);
  window.App.cancelarEnvio = async (cid) => {
    if (!confirm('Cancelar o envio desta campanha?')) return;
    await api(`/api/campanhas/${cid}/envio/cancelar`, { method: 'POST' });
  };
}

/* ============================================================
   MEDIDAS
   ============================================================ */
async function medidas() {
  const dados = await api('/api/medidas');
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span class="text-muted small">${dados.length} unidade(s) de medida</span>
        <button class="btn btn-primary btn-sm" data-perm-acao="medidas.editar" onclick="App.novaMedida()"><span class="material-symbols-outlined">add</span> Nova Medida</button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr><th>Descrição</th><th>Tipo</th><th>Cadastrado</th><th class="text-end">Ações</th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
      <div class="card-footer bg-transparent text-muted small">
        Medidas marcadas como <span class="badge text-bg-primary">inteira</span> só aceitam quantidades inteiras (ex.: unidade) — não admitem decimais em insumos, receitas ou precificações.
      </div>
    </div>`;
  const tbody = $('#tbody');
  tbody.innerHTML = dados.length ? dados.map(m => `
    <tr>
      <td><strong>${esc(m.descricao)}</strong></td>
      <td>${m.inteiro ? '<span class="badge text-bg-primary">inteira</span>' : '<span class="badge text-bg-secondary">fracionária</span>'}</td>
      <td class="text-muted small">${dataBR(m.created_at)}</td>
      <td class="text-end actions text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirMedida(${m.id})"><span class="material-symbols-outlined">edit</span></button>
        <button class="btn btn-sm btn-outline-danger" onclick="App.excluirMedida(${m.id})"><span class="material-symbols-outlined">delete</span></button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="4" class="text-center text-muted py-4">Nenhuma medida cadastrada.</td></tr>';

  window.App.novaMedida = () => openModal(htmlFormMedida(null));
  window.App.abrirMedida = async (id) => {
    const m = (await api('/api/medidas')).find(x => x.id === id);
    openModal(htmlFormMedida({ id: m.id, descricao: m.descricao, inteiro: m.inteiro }));
  };
  window.App.salvarMedida = async (id) => {
    const b = formData('formMedida');
    try {
      id ? await api(`/api/medidas/${id}`, { method: 'PUT', body: b })
        : await api('/api/medidas', { method: 'POST', body: b });
      closeModal();
      invalidarCache();
      toast('Medida salva.');
      medidas();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
  window.App.excluirMedida = async (id) => {
    if (!confirm('Excluir esta medida?')) return;
    try {
      await api(`/api/medidas/${id}`, { method: 'DELETE' });
      invalidarCache();
      toast('Medida excluída.');
      medidas();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
}

function htmlFormMedida(m) {
  const id = m ? m.id : null;
  const v = m ? esc(m.descricao) : '';
  const inteiro = m ? !!m.inteiro : false;
  return `
  <div class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${id ? 'Editar Medida' : 'Nova Medida'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="formMedida" class="row g-3">
            <div class="col-12">
              <label class="form-label">Descrição *</label>
              <input name="descricao" class="form-control" value="${v}" placeholder="Ex.: kg, g, L, Unidade" required>
            </div>
            <div class="col-12 form-check form-switch">
              <input class="form-check-input" type="checkbox" role="switch" id="medidaInteiro" name="inteiro" ${inteiro ? 'checked' : ''}>
              <label class="form-check-label" for="medidaInteiro">
                <strong>Medida inteira</strong>
                <span class="d-block small text-muted">Só aceita quantidades inteiras positivas (ex.: Unidade). Não permite casas decimais.</span>
              </label>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" onclick="App.salvarMedida(${id ?? ''})">Salvar</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   INSUMOS
   ============================================================ */
async function insumos() {
  const dados = await api('/api/insumos');
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <input class="form-control form-control-sm search-control" id="filtro" placeholder="Buscar...">
        <button class="btn btn-primary btn-sm" data-perm-acao="insumos.editar" onclick="App.novoInsumo()"><span class="material-symbols-outlined">add</span> Novo Insumo</button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr><th>Produto</th><th>Qtd. Compra</th><th>Medida</th><th>Valor</th><th>Custo Unitário</th><th>Cadastrado</th><th class="text-end">Ações</th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>
    <div class="alert alert-light border small" style="background:#fafafa">
      <span class="material-symbols-outlined" style="font-size:1rem">auto_awesome</span>
      <strong>Recálculo automático:</strong> ao alterar o valor de um insumo, o custo das receitas e precificações que o utilizam é recalculado automaticamente.
    </div>`;
  const tbody = $('#tbody');
  const linha = i => `
    <tr>
      <td><strong>${esc(i.produto)}</strong></td>
      <td>${qtd(i.quantidade_compra, i.medida_inteiro)}</td>
      <td>${esc(i.medida || '-')}</td>
      <td>${money(i.valor)}</td>
      <td><span class="badge text-bg-light border">${money(i.custo_unitario)}</span></td>
      <td class="text-muted small">${dataBR(i.created_at)}</td>
      <td class="text-end actions text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirInsumo(${i.id})"><span class="material-symbols-outlined">edit</span></button>
        <button class="btn btn-sm btn-outline-danger" onclick="App.excluirInsumo(${i.id})"><span class="material-symbols-outlined">delete</span></button>
      </td>
    </tr>`;
  tbody.innerHTML = dados.length ? dados.map(linha).join('')
    : '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum insumo cadastrado.</td></tr>';
  $('#filtro').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filt = dados.filter(i => (i.produto || '').toLowerCase().includes(q));
    tbody.innerHTML = filt.length ? filt.map(linha).join('')
      : '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum insumo encontrado.</td></tr>';
  });

  window.App.novoInsumo = () => abrirFormInsumo(null);
  window.App.abrirInsumo = async (id) => {
    const i = await api(`/api/insumos/${id}`);
    abrirFormInsumo(i);
  };
  window.App.salvarInsumo = async (id) => {
    const b = formData('formInsumo');
    b.quantidade_compra = Number(b.quantidade_compra);
    b.valor = Number(b.valor);
    b.medida_id = b.medida_id || null;
    try {
      id ? await api(`/api/insumos/${id}`, { method: 'PUT', body: b })
        : await api('/api/insumos', { method: 'POST', body: b });
      closeModal();
      invalidarCache();
      toast('Insumo salvo com sucesso. Custos recalculados automaticamente.');
      insumos();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
  window.App.excluirInsumo = async (id) => {
    if (!confirm('Excluir este insumo? Ele será removido das receitas e precificações.')) return;
    try {
      await api(`/api/insumos/${id}`, { method: 'DELETE' });
      invalidarCache();
      toast('Insumo excluído.');
      insumos();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
}

async function abrirFormInsumo(i) {
  const medidas = await opcoesMedidas();
  const id = i ? i.id : null;
  const v = f => i ? esc(i[f] ?? '') : '';
  openModal(`
  <div class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${id ? 'Editar Insumo' : 'Novo Insumo'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="formInsumo" class="row g-3">
            <div class="col-12"><label class="form-label">Produto *</label>
              <input name="produto" class="form-control" value="${v('produto')}" required></div>
            <div class="col-md-4"><label class="form-label">Qtd. de compra *</label>
              <input name="quantidade_compra" type="number" step="0.001" min="0.001" class="form-control" value="${v('quantidade_compra') || '1'}" required></div>
            <div class="col-md-4"><label class="form-label">Medida</label>
              <select name="medida_id" class="form-select" onchange="sincInteiro(this, '#formInsumo [name=quantidade_compra]')">
                ${selectMedidas(medidas, i?.medida_id || '')}
              </select></div>
            <div class="col-md-4"><label class="form-label">Valor (R$) *</label>
              <input name="valor" type="number" step="0.01" min="0" class="form-control" value="${v('valor') || '0'}" required></div>
            <div class="col-12"><small class="text-muted">O custo unitário (valor ÷ quantidade) é usado no cálculo de receitas e precificações.
              Medidas marcadas como "inteiras" (ex.: unidade) aceitam apenas quantidades inteiras positivas.</small></div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" onclick="App.salvarInsumo(${id ?? ''})">Salvar</button>
        </div>
      </div>
    </div>
  </div>`);
  sincInteiro($('#formInsumo [name=medida_id]'), $('#formInsumo [name=quantidade_compra]'));
}

/* ============================================================
   RECEITAS PRONTAS
   ============================================================ */
async function receitas() {
  const dados = await api('/api/receitas');
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span class="text-muted small">${dados.length} receita(s) cadastrada(s)</span>
        <button class="btn btn-primary btn-sm" data-perm-acao="receitas.editar" onclick="App.novaReceita()"><span class="material-symbols-outlined">add</span> Nova Receita</button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr><th>Nome</th><th>Insumos</th><th>Custo Calculado</th><th>Cadastrado</th><th class="text-end">Ações</th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>
    <div class="alert alert-light border small" style="background:#fafafa">
      <span class="material-symbols-outlined" style="font-size:1rem">info</span>
      Os custos não são gravados: são exibidos sempre com base no valor atual dos insumos.
    </div>`;
  const tbody = $('#tbody');
  tbody.innerHTML = dados.length ? dados.map(r => `
    <tr>
      <td><strong>${esc(r.nome)}</strong></td>
      <td>${r.itens} insumo(s)</td>
      <td><span class="badge text-bg-light border">${money(r.custo_calculado)}</span></td>
      <td class="text-muted small">${dataBR(r.created_at)}</td>
      <td class="text-end actions text-nowrap">
        <button class="btn btn-sm btn-outline-primary" onclick="App.verReceita(${r.id})"><span class="material-symbols-outlined">visibility</span></button>
        <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirReceita(${r.id})"><span class="material-symbols-outlined">edit</span></button>
        <button class="btn btn-sm btn-outline-danger" onclick="App.excluirReceita(${r.id})"><span class="material-symbols-outlined">delete</span></button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="text-center text-muted py-4">Nenhuma receita cadastrada.</td></tr>';

  window.App.verReceita = async (id) => {
    const r = await api(`/api/receitas/${id}`);
    openModal(`
      <div class="modal fade" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${esc(r.nome)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <ul class="x-item-list">
                ${r.itens.map(it => `<li class="d-flex justify-content-between">
                  <span>${esc(it.produto)} <span class="text-muted">(${qtd(it.quantidade, it.medida_inteiro)} ${esc(it.medida || '')})</span></span>
                  <span><strong>${money(it.custo_item)}</strong></span>
                </li>`).join('')}
              </ul>
              <div class="d-flex justify-content-end mt-3 fs-5">
                <strong>Custo calculado: ${money(r.custo_calculado)}</strong>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            </div>
          </div>
        </div>
      </div>`);
  };
  window.App.novaReceita = () => abrirFormReceita(null);
  window.App.abrirReceita = async (id) => {
    const r = await api(`/api/receitas/${id}`);
    abrirFormReceita(r);
  };
  window.App.salvarReceita = async (id) => {
    const b = formData('formReceita');
    const itens = $$('.item-row', $('#formReceita')).map(linha => ({
      insumo_id: +$('[name=insumo_id]', linha).value,
      quantidade: +$('[name=quantidade]', linha).value
    })).filter(it => it.insumo_id && it.quantidade > 0);
    b.itens = itens;
    try {
      id ? await api(`/api/receitas/${id}`, { method: 'PUT', body: b })
        : await api('/api/receitas', { method: 'POST', body: b });
      closeModal();
      invalidarCache();
      toast('Receita salva com sucesso.');
      receitas();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
  window.App.excluirReceita = async (id) => {
    if (!confirm('Excluir esta receita?')) return;
    try {
      await api(`/api/receitas/${id}`, { method: 'DELETE' });
      invalidarCache();
      toast('Receita excluída.');
      receitas();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
}

async function abrirFormReceita(r) {
  const insumos = await opcoesInsumos();
  const id = r ? r.id : null;
  const baseItens = r ? r.itens : [];
  openModal(`
  <div class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${id ? 'Editar Receita' : 'Nova Receita'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="formReceita">
            <div class="mb-3">
              <label class="form-label">Nome da receita *</label>
              <input name="nome" class="form-control" value="${r ? esc(r.nome) : ''}" placeholder="Ex.: Bolo de chocolate" required>
            </div>
            <label class="form-label"><strong>Insumos utilizados</strong></label>
            <div class="bg-light p-3 rounded-3">
              <div id="itensReceita"></div>
              <button type="button" class="btn btn-outline-primary btn-sm mt-2" onclick="App.addItemReceita(this)">
                <span class="material-symbols-outlined">add</span> Adicionar insumo
              </button>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" onclick="App.salvarReceita(${id ?? ''})">Salvar</button>
        </div>
      </div>
    </div>
  </div>`);

  const container = $('#itensReceita');
  const htmlItem = (it = {}) => `
    <div class="row g-2 item-row align-items-center">
      <div class="col-7 col-md-8">
        <select name="insumo_id" class="form-select form-select-sm"
          onchange="sincInteiro(this, this.closest('.item-row').querySelector('[name=quantidade]'))">
          ${selectInsumos(insumos, it.insumo_id || '')}
        </select>
      </div>
      <div class="col-5 col-md-3">
        <input name="quantidade" type="number" step="0.001" min="0.001" class="form-control form-control-sm"
          placeholder="Qtd." value="${it.quantidade != null ? it.quantidade : ''}">
      </div>
      <div class="col-12 col-md-1 text-md-end">
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.item-row').remove()">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>`;
  container.innerHTML = baseItens.length ? baseItens.map(htmlItem).join('') : htmlItem();
  $$('.item-row', container).forEach(row => {
    sincInteiro($('[name=insumo_id]', row), $('[name=quantidade]', row));
  });
  window.App.addItemReceita = (btn) => {
    const wrap = $('#itensReceita');
    wrap.insertAdjacentHTML('beforeend', htmlItem());
  };
}

/* ============================================================
   PRECIFICAÇÃO
   ============================================================ */
async function precificacao() {
  const dados = await api('/api/precificacao');
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span class="text-muted small">${dados.length} produto(s) precificado(s)</span>
        <button class="btn btn-primary btn-sm" data-perm-acao="precificacao.editar" onclick="App.novaPrecificacao()"><span class="material-symbols-outlined">add</span> Nova Precificação</button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr><th>Produto</th><th>Itens</th><th>Valor Calculado</th><th>Cadastrado</th><th class="text-end">Ações</th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>
    <div class="alert alert-light border small" style="background:#fafafa">
      <span class="material-symbols-outlined" style="font-size:1rem">info</span>
      O valor é calculado no momento da exibição, a partir do custo atual dos insumos (regra de negócio).
    </div>`;
  const tbody = $('#tbody');
  tbody.innerHTML = dados.length ? dados.map(p => `
    <tr>
      <td><strong>${esc(p.nome)}</strong></td>
      <td>${p.itens} item(ns)</td>
      <td><span class="badge text-bg-light border">${money(p.valor_calculado)}</span></td>
      <td class="text-muted small">${dataBR(p.created_at)}</td>
      <td class="text-end actions text-nowrap">
        <button class="btn btn-sm btn-outline-primary" onclick="App.verPrecificacao(${p.id})"><span class="material-symbols-outlined">visibility</span></button>
        <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirPrecificacao(${p.id})"><span class="material-symbols-outlined">edit</span></button>
        <button class="btn btn-sm btn-outline-danger" onclick="App.excluirPrecificacao(${p.id})"><span class="material-symbols-outlined">delete</span></button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="text-center text-muted py-4">Nenhuma precificação cadastrada.</td></tr>';

  window.App.verPrecificacao = async (id) => {
    const p = await api(`/api/precificacao/${id}`);
    openModal(`
      <div class="modal fade" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${esc(p.nome)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              ${p.descricao ? `<small class="text-muted">${esc(p.descricao)}</small>` : ''}
              <ul class="x-item-list mt-2">
                ${p.itens.map(it => {
                  const nome = it.tipo === 'insumo' ? it.produto : it.receita_nome;
                  const det = it.tipo === 'insumo'
                    ? qtd(it.quantidade, it.medida_inteiro) + ' ' + esc(it.medida || '')
                    : 'receita pronta';
                  return `<li class="d-flex justify-content-between">
                    <span>${esc(nome)} <span class="text-muted">(${det})</span></span>
                    <span><strong>${money(it.valor_item)}</strong></span>
                  </li>`;
                }).join('')}
              </ul>
              <div class="d-flex justify-content-end mt-3 fs-5">
                <strong>Valor calculado: ${money(p.valor_calculado)}</strong>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            </div>
          </div>
        </div>
      </div>`);
  };
  window.App.novaPrecificacao = () => abrirFormPrecificacao(null);
  window.App.abrirPrecificacao = async (id) => {
    const p = await api(`/api/precificacao/${id}`);
    abrirFormPrecificacao(p);
  };
  window.App.salvarPrecificacao = async (id) => {
    const b = formData('formPrecificacao');
    const itens = $$('.item-row', $('#formPrecificacao')).map(linha => {
      const tipo = $('[name=tipo]', linha).value;
      return {
        tipo,
        insumo_id: tipo === 'insumo' ? +$('[name=insumo_id]', linha).value : null,
        receita_id: tipo === 'receita' ? +$('[name=receita_id]', linha).value : null,
        quantidade: +$('[name=quantidade]', linha).value
      };
    }).filter(it => it.quantidade > 0 && (it.insumo_id || it.receita_id));
    b.itens = itens;
    try {
      id ? await api(`/api/precificacao/${id}`, { method: 'PUT', body: b })
        : await api('/api/precificacao', { method: 'POST', body: b });
      closeModal();
      invalidarCache();
      toast('Precificação salva com sucesso.');
      precificacao();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
  window.App.excluirPrecificacao = async (id) => {
    if (!confirm('Excluir esta precificação?')) return;
    try {
      await api(`/api/precificacao/${id}`, { method: 'DELETE' });
      invalidarCache();
      toast('Precificação excluída.');
      precificacao();
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
}

async function abrirFormPrecificacao(p) {
  const insumos = await opcoesInsumos();
  const receitasOpts = await opcoesReceitas();
  const id = p ? p.id : null;
  const baseItens = p ? p.itens : [];
  openModal(`
  <div class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${id ? 'Editar Precificação' : 'Nova Precificação'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="formPrecificacao">
            <div class="row g-3 mb-3">
              <div class="col-md-6"><label class="form-label">Nome do produto *</label>
                <input name="nome" class="form-control" value="${p ? esc(p.nome) : ''}" placeholder="Ex.: Bolo de chocolate (kg)" required></div>
              <div class="col-md-6"><label class="form-label">Descrição</label>
                <input name="descricao" class="form-control" value="${p ? esc(p.descricao || '') : ''}"></div>
            </div>
            <label class="form-label"><strong>Composição (insumos e/ou receitas prontas)</strong></label>
            <div class="bg-light p-3 rounded-3">
              <div id="itensPrec"></div>
              <button type="button" class="btn btn-outline-primary btn-sm mt-2" onclick="App.addItemPrec(this)">
                <span class="material-symbols-outlined">add</span> Adicionar item
              </button>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" onclick="App.salvarPrecificacao(${id ?? ''})">Salvar</button>
        </div>
      </div>
    </div>
  </div>`);

  const container = $('#itensPrec');
  const htmlItem = (it = {}) => {
    const tipo = it.tipo || 'insumo';
    return `
      <div class="row g-2 item-row">
        <div class="col-md-2">
          <select name="tipo" class="form-select form-select-sm" onchange="App.tipoItemPrec(this)">
            <option value="insumo" ${tipo === 'insumo' ? 'selected' : ''}>Insumo</option>
            <option value="receita" ${tipo === 'receita' ? 'selected' : ''}>Receita Pronta</option>
          </select>
        </div>
        <div class="col-md-4">
          <select name="insumo_id" class="form-select form-select-sm sel-insumo ${tipo !== 'insumo' ? 'd-none' : ''}"
            onchange="sincInteiro(this, this.closest('.item-row').querySelector('[name=quantidade]'))">
            ${selectInsumos(insumos, it.insumo_id || '')}
          </select>
          <select name="receita_id" class="form-select form-select-sm sel-receita ${tipo !== 'receita' ? 'd-none' : ''}">
            ${selectReceitas(receitasOpts, it.receita_id || '')}
          </select>
        </div>
        <div class="col-md-4">
          <input name="quantidade" type="number" step="0.001" min="0.001" class="form-control form-control-sm"
            placeholder="Qtd." value="${it.quantidade != null ? it.quantidade : ''}">
        </div>
        <div class="col-md-2 text-md-end">
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.item-row').remove()">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>`;
  };
  container.innerHTML = baseItens.length ? baseItens.map(htmlItem).join('') : htmlItem();
  $$('.item-row', container).forEach(row => {
    const selIns = $('[name=insumo_id]', row);
    const q = $('[name=quantidade]', row);
    if (!selIns.classList.contains('d-none')) sincInteiro(selIns, q);
  });

  window.App.tipoItemPrec = (sel) => {
    const row = sel.closest('.item-row');
    const showInsumo = sel.value === 'insumo';
    $('.sel-insumo', row).classList.toggle('d-none', !showInsumo);
    $('.sel-receita', row).classList.toggle('d-none', showInsumo);
    const q = $('[name=quantidade]', row);
    if (showInsumo) {
      sincInteiro($('.sel-insumo', row), q);
    } else {
      q.step = '0.001';
      q.min = '0.001';
    }
  };
  window.App.addItemPrec = () => container.insertAdjacentHTML('beforeend', htmlItem());
}

/* ============================================================
   FLUXO DE CAIXA
   ============================================================ */
async function caixa(inicio = '', fim = '') {
  const qs = new URLSearchParams({ inicio, fim });
  const d = await api('/api/caixa?' + qs.toString());
  const totais = d?.totais || {};
  const lancamentos = Array.isArray(d?.lancamentos) ? d.lancamentos : [];
  const stat = (icon, cor, label, valor) => `
    <div class="col-12 col-sm-6 col-md-4 col-xl-3">
      <div class="stat-card d-flex align-items-center gap-3">
        <div class="icon" style="background:${cor}"><span class="material-symbols-outlined">${icon}</span></div>
        <div class="lh-1">
          <div class="valor">${valor}</div>
          <div class="text-muted small">${label}</div>
        </div>
      </div>
    </div>`;
  $('#content').innerHTML = `
    <div class="row g-3">
      ${stat('south_west', '#27ae60', 'Entradas', money(totais.total_entradas))}
      ${stat('north_east', '#e74c3c', 'Saídas', money(totais.total_saidas))}
      ${stat('account_balance', '#2c3e50', 'Saldo', money(totais.saldo))}
    </div>
    <div class="card-crud">
      <div class="card-header cash-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="filter-period">
          <input type="date" id="fInicio" class="form-control form-control-sm" value="${inicio}">
          <span class="text-muted small">até</span>
          <input type="date" id="fFim" class="form-control form-control-sm" value="${fim}">
          <button class="btn btn-sm btn-outline-primary" onclick="App.filtrarCaixa()"><span class="material-symbols-outlined">filter_alt</span> Filtrar</button>
        </div>
        <button class="btn btn-primary btn-sm" data-perm-acao="caixa.editar" onclick="App.novoLancamento()"><span class="material-symbols-outlined">add</span> Novo Lançamento</button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Valor</th><th class="text-end">Ações</th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>`;

  const tbody = $('#tbody');
  tbody.innerHTML = lancamentos.length ? lancamentos.map(l => `
    <tr>
      <td>${dataBR(l.data_lancamento)}</td>
      <td><span class="badge ${l.tipo === 'entrada' ? 'text-bg-success' : 'text-bg-danger'}">${l.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
      <td>${esc(l.descricao)}</td>
      <td class="${l.tipo === 'entrada' ? 'text-success' : 'text-danger'}"><strong>${l.tipo === 'entrada' ? '+' : '-'} ${money(l.valor)}</strong></td>
      <td class="text-end actions text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirLancamento(${l.id})"><span class="material-symbols-outlined">edit</span></button>
        <button class="btn btn-sm btn-outline-danger" onclick="App.excluirLancamento(${l.id})"><span class="material-symbols-outlined">delete</span></button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="text-center text-muted py-4">Nenhum lançamento no período.</td></tr>';

  window.App.filtrarCaixa = () => caixa($('#fInicio').value, $('#fFim').value);
  window.App.novoLancamento = () => openModal(htmlFormLancamento(null));
  window.App.abrirLancamento = async (id) => {
    const l = (await api('/api/caixa')).lancamentos.find(x => x.id === id);
    openModal(htmlFormLancamento(l));
  };
  window.App.salvarLancamento = async (id) => {
    const b = formData('formLancamento');
    b.valor = Number(b.valor);
    try {
      id ? await api(`/api/caixa/${id}`, { method: 'PUT', body: b })
        : await api('/api/caixa', { method: 'POST', body: b });
      closeModal();
      toast('Lançamento salvo.');
      caixa($('#fInicio')?.value, $('#fFim')?.value);
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
  window.App.excluirLancamento = async (id) => {
    if (!confirm('Excluir este lançamento?')) return;
    try {
      await api(`/api/caixa/${id}`, { method: 'DELETE' });
      toast('Lançamento excluído.');
      caixa($('#fInicio')?.value, $('#fFim')?.value);
    } catch (e) { toast(esc(e.message), 'danger'); }
  };
}

function htmlFormLancamento(l) {
  const id = l ? l.id : null;
  const v = f => l ? esc(l[f] ?? '') : '';
  return `
  <div class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${id ? 'Editar Lançamento' : 'Novo Lançamento'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="formLancamento" class="row g-3">
            <div class="col-12"><label class="form-label">Tipo *</label>
              <select name="tipo" class="form-select">
                <option value="entrada" ${l?.tipo === 'entrada' ? 'selected' : ''}>Entrada (receita)</option>
                <option value="saida" ${l?.tipo === 'saida' ? 'selected' : ''}>Saída (despesa)</option>
              </select></div>
            <div class="col-12"><label class="form-label">Descrição *</label>
              <input name="descricao" class="form-control" value="${v('descricao')}" required></div>
            <div class="col-md-6"><label class="form-label">Valor (R$) *</label>
              <input name="valor" type="number" step="0.01" min="0.01" class="form-control" value="${v('valor')}" required></div>
            <div class="col-md-6"><label class="form-label">Data *</label>
              <input name="data_lancamento" type="date" class="form-control" value="${v('data_lancamento') || hoje()}" required></div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" onclick="App.salvarLancamento(${id ?? ''})">Salvar</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   RELATÓRIOS (PDF)
   ============================================================ */
async function relatorios() {
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header"><strong>Relatórios em PDF</strong>
        <small class="text-muted d-block">Todos os relatórios são gerados e disponibilizados para download no formato PDF.</small>
      </div>
      <div class="card-body">
        <div class="row g-3">
          ${cardRel('Clientes', 'people', 'Listagem completa dos clientes cadastrados.', '/api/relatorios/clientes.pdf')}
          ${cardRel('Campanhas', 'campaign', 'Relação das campanhas com período.', '/api/relatorios/campanhas.pdf')}
          ${cardRel('Insumos', 'inventory_2', 'Insumos com custo unitário calculado.', '/api/relatorios/insumos.pdf')}
          ${cardRel('Receitas Prontas', 'menu_book', 'Receitas com detalhe dos insumos e custo calculado.', '/api/relatorios/receitas.pdf')}
          ${cardRel('Precificação', 'sell', 'Produtos precificados com composição e valor calculado.', '/api/relatorios/precificacao.pdf')}
          ${cardRel('Fluxo de Caixa', 'account_balance_wallet', 'Lançamentos de entrada/saída e saldo do período.', '/api/relatorios/caixa.pdf', true)}
        </div>
      </div>
    </div>`;

  window.App.gerarRelatorio = (url) => {
    const inicio = $('#relInicio').value;
    const fim = $('#relFim').value;
    const qs = new URLSearchParams({ inicio, fim });
    const finalUrl = url.includes('caixa.pdf') ? url + '?' + qs.toString() : url;
    const w = window.open(finalUrl, '_blank');
    if (!w) toast('Permita pop-ups para baixar o PDF.', 'danger');
    else toast('Gerando PDF...');
  };
}

function cardRel(titulo, icon, desc, url, temPeriodo = false) {
  return `
    <div class="col-md-6 col-xl-4">
      <div class="recent-card">
        <h6><span class="material-symbols-outlined" style="color:#8e44ad">${icon}</span> ${titulo}</h6>
        <p class="text-muted small flex-grow-1">${desc}</p>
        ${temPeriodo ? `
          <div class="report-period">
            <input type="date" id="relInicio" class="form-control form-control-sm">
            <input type="date" id="relFim" class="form-control form-control-sm">
          </div>` : ''}
        <button class="btn btn-primary btn-sm w-100" onclick="App.gerarRelatorio('${url}')">
          <span class="material-symbols-outlined">picture_as_pdf</span> Baixar PDF
        </button>
      </div>
    </div>`;
}

/* ============================================================
   SEGURANÇA - USUÁRIOS
   ============================================================ */
const cacheGrupos = { dados: null };
async function todosGrupos(forcar = false) {
  if (forcar || !cacheGrupos.dados) cacheGrupos.dados = await api('/api/grupos');
  return cacheGrupos.dados;
}
function invalidarGrupos() { cacheGrupos.dados = null; }

const rotuloSituacao = u => {
  if (u.situacao === 'bloqueado') return '<span class="badge text-bg-danger badge-status">bloqueado</span>';
  if (u.bloqueio_ate) return '<span class="badge text-bg-warning badge-status">bloqueio temporário</span>';
  return '<span class="badge text-bg-success badge-status">ativo</span>';
};

const rotuloEmail = u => u.email_verificado
  ? `<span class="badge text-bg-success badge-status" title="E-mail confirmado">e-mail ok</span>`
  : '<span class="badge text-bg-secondary badge-status" title="E-mail ainda não confirmado">e-mail pendente</span>';

async function usuarios() {
  const podeEditar = temPermissao('usuarios.editar');
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <input class="form-control form-control-sm search-control" id="filtroUsuarios" placeholder="Buscar por nome, usuário, e-mail ou telefone...">
        ${podeEditar ? `<button class="btn btn-primary btn-sm" onclick="App.novoUsuario()">
          <span class="material-symbols-outlined">person_add</span> Novo Usuário</button>` : ''}
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr>
            <th>Usuário</th><th>Contato</th><th>Grupos</th><th>Acesso</th>
            <th>Situação</th><th>Último acesso</th><th class="text-end">Ações</th>
          </tr></thead>
          <tbody id="tbodyUsuarios"></tbody>
        </table>
      </div>
    </div>`;

  const [lista, grupos] = await Promise.all([api('/api/usuarios'), todosGrupos()]);
  cacheGrupos.dados = grupos;

  const linha = u => `
    <tr>
      <td>
        <div class="d-flex align-items-center gap-2">
          ${avatarHtml(u, 'avatar-md')}
          <div class="lh-sm">
            <strong>${esc(u.nome)}</strong>
            <div class="text-muted small">@${esc(u.usuario)}${u.cargo ? ` · ${esc(u.cargo)}` : ''}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="small">${esc(u.email || '-')}</div>
        <div class="text-muted small">${esc(u.telefone || '-')}</div>
        <div class="mt-1">${rotuloEmail(u)}</div>
      </td>
      <td>${u.grupos.length
        ? u.grupos.map(g => `<span class="badge text-bg-light">${esc(g.nome)}</span>`).join(' ')
        : '<span class="text-muted small">sem grupo</span>'}</td>
      <td>${u.acesso_total
        ? '<span class="badge text-bg-primary badge-status">acesso total</span>'
        : '<span class="text-muted small">limitado</span>'}</td>
      <td>${rotuloSituacao(u)}${u.deve_alterar_senha
        ? '<div class="mt-1"><span class="badge text-bg-warning badge-status">senha provisória</span></div>' : ''}</td>
      <td class="text-muted small">${u.ultimo_acesso ? dataBR(u.ultimo_acesso) : 'nunca'}</td>
      <td class="text-end actions text-nowrap">
        ${podeEditar ? `
          <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirUsuario(${u.id})" title="Editar"><span class="material-symbols-outlined">edit</span></button>
          <button class="btn btn-sm btn-outline-primary" onclick="App.redefinirSenhaUsuario(${u.id})" title="Redefinir senha"><span class="material-symbols-outlined">key</span></button>
          ${u.situacao === 'bloqueado'
            ? `<button class="btn btn-sm btn-outline-success" onclick="App.liberarUsuario(${u.id})" title="Liberar acesso"><span class="material-symbols-outlined">lock_open</span></button>`
            : `<button class="btn btn-sm btn-outline-danger" onclick="App.bloquearUsuario(${u.id})" title="Bloquear acesso"><span class="material-symbols-outlined">lock</span></button>`}
          <button class="btn btn-sm btn-outline-danger" onclick="App.excluirUsuario(${u.id})" title="Excluir"><span class="material-symbols-outlined">delete</span></button>`
        : '<span class="text-muted small">somente leitura</span>'}
      </td>
    </tr>`;

  const desenhar = filtrados => {
    $('#tbodyUsuarios').innerHTML = filtrados.length ? filtrados.map(linha).join('') :
      '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum usuário encontrado.</td></tr>';
  };
  desenhar(lista);

  $('#filtroUsuarios').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) return desenhar(lista);
    desenhar(lista.filter(u => [u.nome, u.usuario, u.email, u.telefone, u.cargo,
      ...u.grupos.map(g => g.nome)].join(' ').toLowerCase().includes(q)));
  });
}

function formGruposCheck(grupos, sel = []) {
  return grupos.map(g => `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" name="grupos" value="${g.id}" id="grp${g.id}"
        ${sel.some(s => Number(s) === g.id) ? 'checked' : ''}>
      <label class="form-check-label" for="grp${g.id}">${esc(g.nome)}</label>
    </div>`).join('') || '<p class="text-muted small mb-0">Nenhum grupo cadastrado.</p>';
}

async function abrirUsuario(id) {
  const [u, grupos] = await Promise.all([api(`/api/usuarios/${id}`), todosGrupos()]);
  const fotoAtual = u.foto_url
    ? `<img src="${esc(u.foto_url)}?v=${Date.now()}" alt="">`
    : esc(iniciais(u.nome));

  openModal(`
    <div class="modal fade" id="modalUsuario" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Editar Usuário</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="formUsuario" class="row g-3">
              <div class="col-md-3 text-center">
                <label class="foto-drop" title="Alterar foto">
                  <span class="avatar avatar-lg">${fotoAtual}</span>
                  <input type="file" name="foto" accept="image/png,image/jpeg,image/webp,image/gif">
                  <span class="foto-overlay"><span class="material-symbols-outlined">photo_camera</span>Alterar</span>
                </label>
                <button type="button" class="btn btn-sm btn-link text-danger p-0 mt-1" onclick="App.removerFotoUsuario(${u.id})">
                  Remover foto
                </button>
              </div>
              <div class="col-md-9 row g-3">
                <div class="col-md-7">
                  <label class="form-label">Nome completo *</label>
                  <input name="nome" class="form-control" value="${esc(u.nome)}" required maxlength="150">
                </div>
                <div class="col-md-5">
                  <label class="form-label">Nome de acesso *</label>
                  <input name="usuario" class="form-control" value="${esc(u.usuario)}" required
                    pattern="[A-Za-z0-9._\\-]{3,60}" title="De 3 a 60 caracteres: letras, números, ponto, hífen ou sublinhado">
                </div>
                <div class="col-md-6">
                  <label class="form-label">E-mail *</label>
                  <input name="email" type="email" class="form-control" value="${esc(u.email)}" required>
                  <div class="form-text">${u.email_verificado
                    ? 'E-mail confirmado.' : 'E-mail ainda não confirmado: a recuperação de senha fica indisponível.'}</div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Telefone</label>
                  <input name="telefone" class="form-control" value="${esc(u.telefone || '')}"
                    placeholder="(11) 90000-0000" pattern="[0-9\\s()+-]{8,30}">
                </div>
                <div class="col-md-6">
                  <label class="form-label">Cargo</label>
                  <input name="cargo" class="form-control" value="${esc(u.cargo || '')}" maxlength="120">
                </div>
                <div class="col-md-6 d-flex align-items-end">
                  <button type="button" class="btn btn-outline-primary w-100" onclick="App.reenviarVerificacao(${u.id})">
                    <span class="material-symbols-outlined">mark_email_read</span> Enviar confirmação de e-mail
                  </button>
                </div>
                <div class="col-12">
                  <label class="form-label">Grupos de acesso</label>
                  <div class="border rounded p-3">${formGruposCheck(grupos, u.grupos.map(g => g.id))}</div>
                </div>
                <div class="col-12">
                  <div class="alert alert-light border small mb-0">
                    <div><strong>Situação:</strong> ${rotuloSituacao(u)}</div>
                    <div><strong>Último acesso:</strong> ${u.ultimo_acesso ? dataBR(u.ultimo_acesso) : 'nunca'}${u.ultimo_ip ? ` (${esc(u.ultimo_ip)})` : ''}</div>
                    ${u.bloqueado_motivo ? `<div><strong>Motivo do bloqueio:</strong> ${esc(u.bloqueado_motivo)}</div>` : ''}
                    ${u.tentativas_falhas ? `<div><strong>Falhas de login:</strong> ${u.tentativas_falhas}</div>` : ''}
                  </div>
                </div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-primary" onclick="App.salvarUsuario(${u.id})">Salvar</button>
          </div>
        </div>
      </div>
    </div>`);
}

App.abrirUsuario = abrirUsuario;

App.novoUsuario = async () => {
  const grupos = await todosGrupos();
  openModal(`
    <div class="modal fade" id="modalNovoUsuario" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Novo Usuário</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="formNovoUsuario" class="row g-3">
              <div class="col-12">
                <label class="form-label">Nome completo *</label>
                <input name="nome" class="form-control" required maxlength="150">
              </div>
              <div class="col-md-6">
                <label class="form-label">Nome de acesso *</label>
                <input name="usuario" class="form-control" required pattern="[A-Za-z0-9._\\-]{3,60}"
                  title="De 3 a 60 caracteres: letras, números, ponto, hífen ou sublinhado">
              </div>
              <div class="col-md-6">
                <label class="form-label">E-mail *</label>
                <input name="email" type="email" class="form-control" required>
              </div>
              <div class="col-md-6">
                <label class="form-label">Telefone</label>
                <input name="telefone" class="form-control" placeholder="(11) 90000-0000">
              </div>
              <div class="col-md-6">
                <label class="form-label">Cargo</label>
                <input name="cargo" class="form-control" maxlength="120">
              </div>
              <div class="col-12">
                <label class="form-label">Senha inicial</label>
                <input name="senha" class="form-control" placeholder="Deixe em branco para gerar automaticamente">
                <div class="form-text">Mínimo de 8 caracteres, com pelo menos uma letra e um número.</div>
              </div>
              <div class="col-12">
                <label class="form-label">Grupos de acesso</label>
                <div class="border rounded p-3">${formGruposCheck(grupos)}</div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-primary" onclick="App.criarUsuario()">Cadastrar</button>
          </div>
        </div>
      </div>
    </div>`);
};

App.criarUsuario = async () => {
  const form = $('#formNovoUsuario');
  const fd = new FormData(form);
  const grupos = fd.getAll('grupos');
  const corpo = {
    nome: fd.get('nome'),
    usuario: fd.get('usuario'),
    email: fd.get('email'),
    telefone: fd.get('telefone'),
    cargo: fd.get('cargo'),
    senha: fd.get('senha') || undefined,
    grupos
  };
  try {
    const r = await api('/api/usuarios', { method: 'POST', body: corpo });
    closeModal();
    toast(esc(r.mensagem));
    mostrarSenhaGerada(r);
    usuarios();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

function mostrarSenhaGerada(r) {
  if (!r.senha_inicial) return;
  openModal(`
    <div class="modal fade" id="modalSenhaGerada" tabindex="-1" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <span class="material-symbols-outlined me-1" style="color:var(--principal)">key</span> Senha inicial
            </h5>
          </div>
          <div class="modal-body">
            <p class="small text-muted">
              ${r.senha_provisoria
                ? 'Senha gerada automaticamente. Entregue ao usuário: ele será obrigado a alterá-la no primeiro acesso.'
                : 'Senha definida por você. O usuário deverá alterá-la no próximo acesso.'}
            </p>
            <div class="input-group">
              <input class="form-control fw-bold" readonly value="${esc(r.senha_inicial)}" id="senhaGerada">
              <button class="btn btn-outline-secondary" type="button" onclick="App.copiarSenha()">
                <span class="material-symbols-outlined">content_copy</span>
              </button>
            </div>
            ${r.confirmacao_email === true
              ? '<div class="alert alert-success small mt-3 mb-0">E-mail de confirmação enviado.</div>'
              : r.confirmacao_email === false
                ? '<div class="alert alert-warning small mt-3 mb-0">Não foi possível enviar a confirmação por e-mail. Reenvie depois de configurar o SMTP.</div>'
                : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" data-bs-dismiss="modal">Entendi</button>
          </div>
        </div>
      </div>
    </div>`);
  $('#senhaGerada').select();
}

App.copiarSenha = async () => {
  try {
    await navigator.clipboard.writeText($('#senhaGerada').value);
    toast('Senha copiada.');
  } catch (e) {
    $('#senhaGerada').select();
    toast('Selecione e copie com Ctrl+C.', 'warning');
  }
};

App.salvarUsuario = async (id) => {
  const fd = new FormData($('#formUsuario'));
  fd.set('grupos', fd.getAll('grupos'));
  if (!fd.get('foto') || !fd.get('foto').size) fd.delete('foto');
  try {
    const r = await apiForm(`/api/usuarios/${id}`, fd, 'PUT');
    closeModal();
    toast(esc(r.mensagem) + (r.email_verificado ? '' : ' E-mail alterado: envie a confirmação.'));
    const dados = await api('/api/auth/me');
    SESSAO = dados.usuario;
    pinturaTopbar();
    usuarios();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.removerFotoUsuario = async (id) => {
  if (!confirm('Remover a foto de perfil deste usuário?')) return;
  try {
    const r = await api(`/api/usuarios/${id}/foto`, { method: 'DELETE' });
    toast(esc(r.mensagem));
    closeModal();
    usuarios();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.reenviarVerificacao = async (id) => {
  try {
    const r = await api(`/api/usuarios/${id}/reenviar-verificacao`, { method: 'POST' });
    toast(esc(r.mensagem));
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.bloquearUsuario = async (id) => {
  const motivo = prompt('Motivo do bloqueio (opcional):');
  if (motivo === null) return;
  try {
    const r = await api(`/api/usuarios/${id}/bloquear`, { method: 'POST', body: { motivo } });
    toast(esc(r.mensagem) + ` ${r.sessoes_encerradas} sessão(ões) encerrada(s).`);
    usuarios();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.liberarUsuario = async (id) => {
  if (!confirm('Liberar o acesso e as sessões deste usuário?')) return;
  try {
    const r = await api(`/api/usuarios/${id}/liberar`, { method: 'POST' });
    toast(esc(r.mensagem));
    usuarios();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.redefinirSenhaUsuario = async (id) => {
  const modo = confirm(
    'OK: enviar o link de redefinição por e-mail.\n\nCancelar: definir uma senha temporária agora.'
  ) ? 'email' : 'temporaria';
  if (modo === 'email') {
    try {
      const r = await api(`/api/usuarios/${id}/redefinir-senha`, { method: 'POST', body: { modo: 'email' } });
      openModal(`
        <div class="modal fade" id="modalResetEmail" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Redefinição por e-mail</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <p class="small">${esc(r.mensagem)}</p>
                ${r.link ? `<div class="alert alert-warning small">
                  <strong>SMTP desativado.</strong> Entregue o link manualmente:<br>
                  <code class="text-break">${esc(r.link)}</code></div>` : ''}
              </div>
              <div class="modal-footer">
                <button class="btn btn-primary" data-bs-dismiss="modal">Fechar</button>
              </div>
            </div>
          </div>
        </div>`);
    } catch (e) { toast(esc(e.message), 'danger'); }
    return;
  }

  const senha = prompt('Senha temporária (mínimo 8 caracteres, com letra e número). Deixe em branco para gerar:');
  if (senha === null) return;
  try {
    const r = await api(`/api/usuarios/${id}/redefinir-senha`, {
      method: 'POST',
      body: { modo: 'temporaria', senha: senha || undefined }
    });
    toast(esc(r.mensagem));
    mostrarSenhaGerada(r);
    usuarios();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.excluirUsuario = async (id) => {
  if (!confirm('Excluir definitivamente este usuário? As sessões dele serão encerradas.')) return;
  try {
    const r = await api(`/api/usuarios/${id}`, { method: 'DELETE' });
    toast(esc(r.mensagem));
    usuarios();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

/* ============================================================
   SEGURANÇA - GRUPOS
   ============================================================ */
async function grupos() {
  const podeEditar = temPermissao('grupos.editar');
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <input class="form-control form-control-sm search-control" id="filtroGrupos" placeholder="Buscar grupo...">
        ${podeEditar ? `<button class="btn btn-primary btn-sm" onclick="App.novoGrupo()">
          <span class="material-symbols-outlined">add</span> Novo Grupo</button>` : ''}
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr>
            <th>Grupo</th><th>Perfis vinculados</th><th>Usuários</th><th>Acesso</th><th class="text-end">Ações</th>
          </tr></thead>
          <tbody id="tbodyGrupos"></tbody>
        </table>
      </div>
    </div>`;

  const lista = await api('/api/grupos');
  const linha = g => `
    <tr>
      <td>
        <strong>${esc(g.nome)}</strong>${g.sistema ? ' <span class="badge text-bg-light badge-status">sistema</span>' : ''}
        <div class="text-muted small">${esc(g.descricao || '-')}</div>
      </td>
      <td>${Number(g.total_perfis) || 0}</td>
      <td>${Number(g.total_usuarios) || 0}</td>
      <td>${g.acesso_total
        ? '<span class="badge text-bg-primary badge-status">acesso total</span>'
        : '<span class="text-muted small">limitado</span>'}</td>
      <td class="text-end actions text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" onclick="App.verGrupo(${g.id})" title="Detalhes"><span class="material-symbols-outlined">visibility</span></button>
        ${podeEditar && !g.sistema ? `
          <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirGrupo(${g.id})" title="Editar"><span class="material-symbols-outlined">edit</span></button>
          <button class="btn btn-sm btn-outline-danger" onclick="App.excluirGrupo(${g.id})" title="Excluir"><span class="material-symbols-outlined">delete</span></button>`
          : `<span class="text-muted small">${g.sistema ? 'protegido' : 'somente leitura'}</span>`}
      </td>
    </tr>`;

  const desenhar = filtrados => {
    $('#tbodyGrupos').innerHTML = filtrados.length ? filtrados.map(linha).join('') :
      '<tr><td colspan="5" class="text-center text-muted py-4">Nenhum grupo encontrado.</td></tr>';
  };
  desenhar(lista);

  $('#filtroGrupos').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    desenhar(q ? lista.filter(g => `${g.nome} ${g.descricao || ''}`.toLowerCase().includes(q)) : lista);
  });
}

async function verGrupo(id) {
  const [g, membros] = await Promise.all([api(`/api/grupos/${id}`), api(`/api/grupos/${id}/usuarios`)]);
  openModal(`
    <div class="modal fade" id="modalVerGrupo" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${esc(g.nome)}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p class="text-muted small">${esc(g.descricao || 'Sem descrição.')}</p>
            <div class="row g-3">
              <div class="col-md-6">
                <h6>Perfis de acesso</h6>
                ${g.perfis.length
                  ? `<ul class="x-item-list">${g.perfis.map(p => `<li class="d-flex justify-content-between">
                      <span>${esc(p.nome)}</span>
                      ${p.acesso_total ? '<span class="badge text-bg-primary">total</span>' : ''}
                    </li>`).join('')}</ul>`
                  : '<p class="text-muted small">Nenhum perfil vinculado: os usuários deste grupo não acessam nada.</p>'}
              </div>
              <div class="col-md-6">
                <h6>Usuários (${membros.length})</h6>
                ${membros.length
                  ? `<ul class="x-item-list">${membros.map(u => `<li class="d-flex align-items-center gap-2">
                      ${avatarHtml(u, 'avatar-sm')}
                      <span class="text-truncate">${esc(u.nome)} <span class="text-muted">@${esc(u.usuario)}</span></span>
                    </li>`).join('')}</ul>`
                  : '<p class="text-muted small">Nenhum usuário neste grupo.</p>'}
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" data-bs-dismiss="modal">Fechar</button>
          </div>
        </div>
      </div>
    </div>`);
}

App.verGrupo = verGrupo;

function formPerfisCheck(perfis, sel = []) {
  return perfis.map(p => `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" name="perfis" value="${p.id}" id="perfil${p.id}"
        ${sel.includes(p.id) ? 'checked' : ''}>
      <label class="form-check-label" for="perfil${p.id}">
        ${esc(p.nome)}${p.acesso_total ? ' <span class="badge text-bg-primary">acesso total</span>' : ''}
      </label>
    </div>`).join('') || '<p class="text-muted small mb-0">Nenhum perfil cadastrado.</p>';
}

App.abrirGrupo = async (id) => {
  const [g, perfis] = await Promise.all([api(`/api/grupos/${id}`), api('/api/perfis')]);
  abrirFormGrupo(g, perfis);
};

App.novoGrupo = async () => {
  abrirFormGrupo(null, await api('/api/perfis'));
};

function abrirFormGrupo(g, perfis) {
  const sel = g ? g.perfis.map(p => p.id) : [];
  openModal(`
    <div class="modal fade" id="modalGrupo" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${g ? 'Editar Grupo' : 'Novo Grupo'}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="formGrupo" class="row g-3">
              <div class="col-12">
                <label class="form-label">Nome do grupo *</label>
                <input name="nome" class="form-control" required maxlength="80" value="${g ? esc(g.nome) : ''}">
              </div>
              <div class="col-12">
                <label class="form-label">Descrição</label>
                <input name="descricao" class="form-control" maxlength="255" value="${g ? esc(g.descricao || '') : ''}">
              </div>
              <div class="col-12">
                <label class="form-label">Perfis de acesso</label>
                <div class="border rounded p-3">${formPerfisCheck(perfis, sel)}</div>
                <div class="form-text">As permissões do usuário são a união dos perfis de todos os seus grupos.</div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-primary" onclick="App.salvarGrupo(${g ? g.id : 'null'})">Salvar</button>
          </div>
        </div>
      </div>
    </div>`);
}

App.salvarGrupo = async (id) => {
  const fd = new FormData($('#formGrupo'));
  const corpo = { nome: fd.get('nome'), descricao: fd.get('descricao'), perfis: fd.getAll('perfis') };
  try {
    if (id) await api(`/api/grupos/${id}/perfis`, { method: 'PUT', body: { perfis: corpo.perfis } });
    const r = id
      ? await api(`/api/grupos/${id}`, { method: 'PUT', body: { nome: corpo.nome, descricao: corpo.descricao } })
      : await api('/api/grupos', { method: 'POST', body: corpo });
    closeModal();
    toast(esc(r.mensagem));
    invalidarGrupos();
    grupos();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.excluirGrupo = async (id) => {
  if (!confirm('Excluir este grupo? Os vínculos com perfis e usuários serão removidos.')) return;
  try {
    const r = await api(`/api/grupos/${id}`, { method: 'DELETE' });
    toast(esc(r.mensagem));
    invalidarGrupos();
    grupos();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

/* ============================================================
   SEGURANÇA - PERFIS DE ACESSO
   ============================================================ */
async function perfis() {
  const podeEditar = temPermissao('perfis.editar');
  const [lista, catalogo] = await Promise.all([api('/api/perfis'), api('/api/perfis/catalogo')]);

  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <p class="mb-0 text-muted small">Cada perfil concede um conjunto de permissões. Combine os perfis nos grupos.</p>
        ${podeEditar ? `<button class="btn btn-primary btn-sm" onclick="App.novoPerfil()">
          <span class="material-symbols-outlined">add</span> Novo Perfil</button>` : ''}
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr>
            <th>Perfil</th><th>Permissões</th><th>Grupos</th><th class="text-end">Ações</th>
          </tr></thead>
          <tbody>
            ${lista.map(p => `
              <tr>
                <td>
                  <strong>${esc(p.nome)}</strong>${p.sistema ? ' <span class="badge text-bg-light badge-status">sistema</span>' : ''}
                  ${p.acesso_total ? ' <span class="badge text-bg-primary badge-status">acesso total</span>' : ''}
                  <div class="text-muted small">${esc(p.descricao || '-')}</div>
                </td>
                <td>${p.acesso_total ? 'todas' : Number(p.total_permissoes) || 0}</td>
                <td>${Number(p.total_grupos) || 0}</td>
                <td class="text-end actions text-nowrap">
                  <button class="btn btn-sm btn-outline-secondary" onclick="App.abrirPerfil(${p.id})" title="Permissões"><span class="material-symbols-outlined">tune</span></button>
                  ${podeEditar && !p.sistema ? `
                    <button class="btn btn-sm btn-outline-danger" onclick="App.excluirPerfil(${p.id})" title="Excluir"><span class="material-symbols-outlined">delete</span>`
                  : `<span class="text-muted small">${p.sistema ? 'protegido' : 'somente leitura'}</span>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="alert alert-light border small">
      <span class="material-symbols-outlined" style="font-size:1rem">info</span>
      O perfil <strong>Acesso Total</strong> é interno do sistema e não pode ser alterado nem excluído.
    </div>`;
}

App.abrirPerfil = async (id) => {
  const [p, catalogo] = await Promise.all([api(`/api/perfis/${id}`), api('/api/perfis/catalogo')]);
  const marcadas = new Set(p.permissoes.map(x => x.chave));
  const bloco = m => `
    <div class="perm-modulo">
      <h6>${esc(m.modulo)}</h6>
      <div class="row g-1">
        ${m.permissoes.map(x => `
          <div class="col-md-6">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" name="permissoes" value="${x.chave}" id="p${x.chave.replace(/\./g, '-')}"
                ${marcadas.has(x.chave) ? 'checked' : ''}>
              <label class="form-check-label" for="p${x.chave.replace(/\./g, '-')}">${esc(x.rotulo)}</label>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  openModal(`
    <div class="modal fade" id="modalPerfil" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Permissões de ${esc(p.nome)}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            ${p.acesso_total
              ? '<div class="alert alert-info">Este perfil concede acesso total a todas as telas e ações.</div>'
              : `<form id="formPerfil" class="row g-3 mb-3">
                   <div class="col-md-8">
                     <label class="form-label">Nome *</label>
                     <input name="nome" class="form-control" required maxlength="80" value="${esc(p.nome)}">
                   </div>
                   <div class="col-md-4">
                     <label class="form-label">Descrição</label>
                     <input name="descricao" class="form-control" maxlength="255" value="${esc(p.descricao || '')}">
                   </div>
                 </form>
                 <div class="perm-grid">${catalogo.modulos.map(bloco).join('')}</div>`}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            ${p.acesso_total ? '' : `<button type="button" class="btn btn-primary" onclick="App.salvarPerfil(${p.id})">Salvar</button>`}
          </div>
        </div>
      </div>
    </div>`);
};

App.novoPerfil = async () => {
  const catalogo = await api('/api/perfis/catalogo');
  const bloco = m => `
    <div class="perm-modulo">
      <h6>${esc(m.modulo)}</h6>
      <div class="row g-1">
        ${m.permissoes.map(x => `
          <div class="col-md-6">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" name="permissoes" value="${x.chave}" id="np${x.chave.replace(/\./g, '-')}">
              <label class="form-check-label" for="np${x.chave.replace(/\./g, '-')}">${esc(x.rotulo)}</label>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  openModal(`
    <div class="modal fade" id="modalPerfil" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Novo Perfil de Acesso</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="formPerfil" class="row g-3 mb-3">
              <div class="col-md-8">
                <label class="form-label">Nome *</label>
                <input name="nome" class="form-control" required maxlength="80">
              </div>
              <div class="col-md-4">
                <label class="form-label">Descrição</label>
                <input name="descricao" class="form-control" maxlength="255">
              </div>
            </form>
            <div class="perm-grid">${catalogo.modulos.map(bloco).join('')}</div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-primary" onclick="App.salvarPerfil(null)">Criar perfil</button>
          </div>
        </div>
      </div>
    </div>`);
};

App.salvarPerfil = async (id) => {
  const fd = new FormData($('#formPerfil'));
  const corpo = {
    nome: fd.get('nome'),
    descricao: fd.get('descricao'),
    permissoes: fd.getAll('permissoes')
  };
  try {
    const r = id
      ? await api(`/api/perfis/${id}`, { method: 'PUT', body: corpo })
      : await api('/api/perfis', { method: 'POST', body: corpo });
    closeModal();
    toast(esc(r.mensagem));
    invalidarGrupos();
    perfis();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.excluirPerfil = async (id) => {
  if (!confirm('Excluir este perfil de acesso?')) return;
  try {
    const r = await api(`/api/perfis/${id}`, { method: 'DELETE' });
    toast(esc(r.mensagem));
    invalidarGrupos();
    perfis();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

/* ============================================================
   SEGURANÇA - AUDITORIA
   ============================================================ */
const rotuloEvento = {
  'login.sucesso': ['login', 'text-bg-success'],
  'login.falha': ['login', 'text-bg-danger'],
  'logout': ['logout', 'text-bg-secondary'],
  'senha.alterada': ['key', 'text-bg-primary'],
  'senha.reset_solicitado': ['mail', 'text-bg-primary'],
  'senha.resetada': ['key', 'text-bg-warning'],
  'perfil.alterado': ['manage_accounts', 'text-bg-info'],
  'usuario.criado': ['person_add', 'text-bg-success'],
  'usuario.editado': ['edit', 'text-bg-info'],
  'usuario.excluido': ['delete', 'text-bg-danger'],
  'usuario.bloqueado': ['lock', 'text-bg-danger'],
  'usuario.liberado': ['lock_open', 'text-bg-success'],
  'usuario.grupos_alterados': ['group', 'text-bg-info'],
  'usuario.foto_atualizada': ['photo_camera', 'text-bg-info'],
  'email.verificado': ['mark_email_read', 'text-bg-success'],
  'email.reenviado': ['forward_to_inbox', 'text-bg-info'],
  'grupo.criado': ['workspaces', 'text-bg-success'],
  'grupo.editado': ['edit', 'text-bg-info'],
  'grupo.excluido': ['delete', 'text-bg-danger'],
  'grupo.perfis_alterados': ['badge', 'text-bg-info'],
  'perfil.criado': ['badge', 'text-bg-success'],
  'perfil.editado': ['edit', 'text-bg-info'],
  'perfil.excluido': ['delete', 'text-bg-danger']
};

async function auditoria(filtros = {}) {
  if (!$('#filtrosAuditoria')) {
    $('#content').innerHTML = `
      <div class="card-crud">
        <div class="card-header">
          <div class="row g-2" id="filtrosAuditoria">
            <div class="col-md-3"><input class="form-control form-control-sm" id="audQ" placeholder="Buscar na descrição, usuário ou IP..."></div>
            <div class="col-md-3"><input type="date" class="form-control form-control-sm" id="audDe" title="Data inicial"></div>
            <div class="col-md-3"><input type="date" class="form-control form-control-sm" id="audAte" title="Data final"></div>
            <div class="col-md-2">
              <select class="form-select form-select-sm" id="audEvento">
                <option value="">Todos os eventos</option>
              </select>
            </div>
            <div class="col-md-1 d-grid">
              <button class="btn btn-sm btn-outline-secondary" onclick="App.limitarAuditoria()">Ir</button>
            </div>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-hover table-crud mb-0">
            <thead><tr>
              <th>Quando</th><th>Evento</th><th>Usuário</th><th>Descrição</th><th>IP</th>
            </tr></thead>
            <tbody id="tbodyAuditoria"></tbody>
          </table>
        </div>
        <div class="card-footer d-flex justify-content-between align-items-center" id="paginacaoAuditoria"></div>
      </div>`;

    ['audQ', 'audDe', 'audAte', 'audEvento'].forEach(id => {
      const el = $(`#${id}`);
      if (id === 'audQ') el.addEventListener('input', debounce(() => auditoria(filtrosAuditoria(0)), 400));
      else el.addEventListener('change', () => auditoria(filtrosAuditoria(0)));
    });
  }

  const params = new URLSearchParams({ limite: '50' });
  if (filtros.q) params.set('q', filtros.q);
  if (filtros.de) params.set('de', filtros.de);
  if (filtros.ate) params.set('ate', filtros.ate);
  if (filtros.evento) params.set('evento', filtros.evento);
  if (filtros.offset) params.set('offset', String(filtros.offset));
  if (filtros.sucesso !== undefined) params.set('sucesso', String(filtros.sucesso));

  const r = await api(`/api/auditoria?${params}`);

  const selEvento = $('#audEvento');
  if (selEvento && selEvento.options.length <= 1) {
    r.eventos.forEach(e => selEvento.add(new Option(e, e)));
  }

  $('#tbodyAuditoria').innerHTML = r.registros.length ? r.registros.map(l => {
    const meta = rotuloEvento[l.evento] || ['info', 'text-bg-light'];
    return `
      <tr class="${l.sucesso ? 'log-ok' : 'log-falha'}">
        <td class="text-muted small text-nowrap">${dataBR(l.created_at)}<div>${new Date(l.created_at).toLocaleTimeString('pt-BR')}</div></td>
        <td><span class="badge ${meta[1]} badge-status"><span class="material-symbols-outlined" style="font-size:.8rem">${meta[0]}</span> ${esc(l.evento)}</span></td>
        <td class="small">${esc(l.usuario_nome || 'sistema')}</td>
        <td class="small log-evt">${esc(l.descricao || '-')}</td>
        <td class="text-muted small">${esc(l.ip || '-')}</td>
      </tr>`;
  }).join('') : '<tr><td colspan="5" class="text-center text-muted py-4">Nenhum evento encontrado.</td></tr>';

  const inicio = r.total ? r.offset + 1 : 0;
  const fim = Math.min(r.offset + r.limite, r.total);
  $('#paginacaoAuditoria').innerHTML = `
    <small class="text-muted">${inicio}–${fim} de ${r.total} registro(s)</small>
    <div class="btn-group btn-group-sm">
      <button class="btn btn-outline-secondary" ${r.offset <= 0 ? 'disabled' : ''} onclick="App.paginarAuditoria(-1)">Anterior</button>
      <button class="btn btn-outline-secondary" ${fim >= r.total ? 'disabled' : ''} onclick="App.paginarAuditoria(1)">Próxima</button>
    </div>`;
  App._auditoriaAtual = { ...filtros, offset: r.offset, limite: r.limite, total: r.total };
}

function filtrosAuditoria(offset) {
  return {
    q: $('#audQ').value.trim(),
    de: $('#audDe').value,
    ate: $('#audAte').value,
    evento: $('#audEvento').value,
    offset
  };
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

App.limitarAuditoria = () => auditoria(filtrosAuditoria(0));
App.paginarAuditoria = (passo) => {
  const a = App._auditoriaAtual || { offset: 0, limite: 50 };
  auditoria({ ...a, offset: Math.max(0, a.offset + passo * a.limite) });
};

/* ============================================================
   MEU PERFIL
   ============================================================ */
async function meuPerfil() {
  const u = SESSAO;
  let sessoes = [];
  try { sessoes = (await api('/api/auth/sessoes')).sessoes; } catch (e) { sessoes = []; }
  $('#content').innerHTML = `
    <div class="row g-3">
      <div class="col-lg-4">
        <div class="card-crud h-100">
          <div class="card-body text-center">
            <label class="foto-drop" title="Alterar foto">
              <span class="avatar avatar-lg" id="minhaFoto">
                ${u.foto_url ? `<img src="${esc(u.foto_url)}?v=${Date.now()}" alt="">` : esc(iniciais(u.nome))}
              </span>
              <input type="file" id="minhaFotoInput" accept="image/png,image/jpeg,image/webp,image/gif">
              <span class="foto-overlay"><span class="material-symbols-outlined">photo_camera</span>Alterar</span>
            </label>
            <h5 class="mt-3 mb-1">${esc(u.nome)}</h5>
            <p class="text-muted small mb-2">@${esc(u.usuario)}</p>
            <div class="d-flex flex-wrap gap-1 justify-content-center">
              ${u.acesso_total ? '<span class="badge text-bg-primary">acesso total</span>' : ''}
              ${u.email_verificado
                ? '<span class="badge text-bg-success">e-mail confirmado</span>'
                : '<span class="badge text-bg-secondary">e-mail pendente</span>'}
            </div>
            <div class="mt-2">${u.grupos.length
              ? u.grupos.map(g => `<span class="badge text-bg-light">${esc(g.nome)}</span>`).join(' ')
              : '<span class="text-muted small">sem grupo vinculado</span>'}</div>
            ${u.foto_url ? `<button class="btn btn-sm btn-link text-danger mt-2" onclick="App.removerMinhaFoto()">Remover foto</button>` : ''}
          </div>
          <div class="card-footer small text-muted">
            <div class="d-flex justify-content-between"><span>Conta criada</span><span>${dataBR(u.ultimo_acesso)}</span></div>
            <div class="d-flex justify-content-between"><span>Último acesso</span><span>${u.ultimo_acesso ? dataBR(u.ultimo_acesso) : 'nunca'}</span></div>
          </div>
        </div>
      </div>

      <div class="col-lg-8">
        <div class="card-crud mb-3">
          <div class="card-header"><h6 class="mb-0">Dados de contato</h6></div>
          <div class="card-body">
            <form id="formMeuPerfil" class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Nome completo *</label>
                <input name="nome" class="form-control" value="${esc(u.nome)}" required maxlength="150">
              </div>
              <div class="col-md-6">
                <label class="form-label">Cargo</label>
                <input name="cargo" class="form-control" value="${esc(u.cargo || '')}" maxlength="120">
              </div>
              <div class="col-md-6">
                <label class="form-label">E-mail preferencial *</label>
                <input name="email" type="email" class="form-control" value="${esc(u.email)}" required>
                <div class="form-text">Usado para recuperação de senha e avisos do sistema.</div>
              </div>
              <div class="col-md-6">
                <label class="form-label">Telefone</label>
                <input name="telefone" class="form-control" value="${esc(u.telefone || '')}"
                  placeholder="(11) 90000-0000" pattern="[0-9\\s()+-]{8,30}">
              </div>
            </form>
          </div>
          <div class="card-footer d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="small text-muted">
              ${u.email_verificado
                ? '<span class="material-symbols-outlined" style="font-size:.9rem">verified</span> E-mail confirmado.'
                : '<span class="material-symbols-outlined" style="font-size:.9rem">warning</span> E-mail ainda não confirmado.'}
            </div>
            <div class="d-flex gap-2">
              ${u.email_verificado ? '' : `<button class="btn btn-sm btn-outline-primary" onclick="App.reenviarMeuVerificacao()">
                <span class="material-symbols-outlined">mark_email_read</span> Enviar confirmação</button>`}
              <button class="btn btn-sm btn-primary" onclick="App.salvarMeuPerfil()">Salvar alterações</button>
            </div>
          </div>
        </div>

        <div class="card-crud mb-3">
          <div class="card-header"><h6 class="mb-0">Alterar senha</h6></div>
          <div class="card-body">
            <form id="formAlterarSenha" class="row g-3">
              <div class="col-md-4">
                <label class="form-label">Senha atual *</label>
                <input name="senhaAtual" type="password" class="form-control" autocomplete="current-password" required>
              </div>
              <div class="col-md-4">
                <label class="form-label">Nova senha *</label>
                <input name="novaSenha" type="password" class="form-control" autocomplete="new-password" required>
              </div>
              <div class="col-md-4">
                <label class="form-label">Repetir a nova senha *</label>
                <input name="confirmaSenha" type="password" class="form-control" autocomplete="new-password" required>
              </div>
            </form>
          </div>
          <div class="card-footer text-end">
            <button class="btn btn-sm btn-primary" onclick="App.alterarMinhaSenha()">
              <span class="material-symbols-outlined">key</span> Alterar senha
            </button>
          </div>
        </div>

        <div class="card-crud">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h6 class="mb-0">Minhas sessões</h6>
            <a href="#/sessoes" class="btn btn-sm btn-outline-secondary">Gerenciar</a>
          </div>
          <div class="card-body"><p class="text-muted small mb-0">
            Há <strong>${sessoes.length}</strong> sessão(ões) ativa(s) vinculada(s) a esta conta.
            Se reconhecer um acesso estranho, encerre a sessão e troque a senha.
          </p></div>
        </div>
      </div>
    </div>`;

  $('#minhaFotoInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    App.enviarFotoPerfil(file).then(() => meuPerfil());
  });
}

App.salvarMeuPerfil = async () => {
  const fd = new FormData($('#formMeuPerfil'));
  const emailAntes = SESSAO.email;
  try {
    const r = await apiForm('/api/auth/meu-perfil', fd, 'PUT');
    const dados = await api('/api/auth/me');
    SESSAO = dados.usuario;
    pinturaTopbar();
    toast(esc(r.mensagem) + (emailAntes === SESSAO.email ? '' : ' Confirme o novo e-mail para habilitar a recuperação.'));
    meuPerfil();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.enviarFotoPerfil = async file => {
  const fd = new FormData();
  fd.append('foto', file);
  try {
    const r = await apiForm('/api/auth/meu-perfil/foto', fd);
    const dados = await api('/api/auth/me');
    SESSAO = dados.usuario;
    pinturaTopbar();
    toast(esc(r.mensagem));
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.removerMinhaFoto = async () => {
  if (!confirm('Remover a sua foto de perfil?')) return;
  try {
    await api('/api/auth/meu-perfil/foto', { method: 'DELETE' });
    const dados = await api('/api/auth/me');
    SESSAO = dados.usuario;
    pinturaTopbar();
    toast('Foto removida.');
    meuPerfil();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.reenviarMeuVerificacao = async () => {
  try {
    const r = await api('/api/auth/reenviar-verificacao', { method: 'POST', body: {} });
    toast(esc(r.mensagem));
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.alterarMinhaSenha = async () => {
  const b = formData('formAlterarSenha');
  if (!b.senhaAtual || !b.novaSenha) return toast('Preencha todos os campos.', 'danger');
  if (b.novaSenha !== b.confirmaSenha) return toast('As senhas informadas não são iguais.', 'danger');
  try {
    const r = await api('/api/auth/alterar-senha', {
      method: 'POST',
      body: { senhaAtual: b.senhaAtual, novaSenha: b.novaSenha }
    });
    const dados = await api('/api/auth/me');
    SESSAO = dados.usuario;
    toast(esc(r.mensagem || 'Senha alterada com sucesso.'));
    $('#formAlterarSenha').reset();
    meuPerfil();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

/* ============================================================
   MINHAS SESSÕES
   ============================================================ */
async function minhasSessoes() {
  const r = await api('/api/auth/sessoes');
  $('#content').innerHTML = `
    <div class="card-crud">
      <div class="card-header d-flex justify-content-between align-items-center">
        <p class="mb-0 text-muted small">Encerre as sessões que não reconhecer e troque a senha.</p>
        <button class="btn btn-sm btn-outline-danger" onclick="App.encerrarOutrasSessoes()">
          <span class="material-symbols-outlined">logout</span> Encerrar as outras
        </button>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover table-crud mb-0">
          <thead><tr>
            <th>Dispositivo</th><th>IP</th><th>Início</th><th>Último uso</th><th>Expira</th><th class="text-end">Ações</th>
          </tr></thead>
          <tbody>
            ${r.sessoes.map(s => `
              <tr class="${s.atual ? 'sessao-atual' : ''}">
                <td>
                  ${s.atual ? '<span class="badge text-bg-primary badge-status">esta sessão</span>' : ''}
                  <div class="small text-truncate" style="max-width:22rem">${esc(s.user_agent || 'desconhecido')}</div>
                </td>
                <td class="small">${esc(s.ip || '-')}</td>
                <td class="text-muted small">${dataBR(s.created_at)}</td>
                <td class="text-muted small">${s.ultimo_acesso ? new Date(s.ultimo_acesso).toLocaleString('pt-BR') : '-'}</td>
                <td class="text-muted small">${dataBR(s.expira_em)}</td>
                <td class="text-end">
                  ${s.atual ? '' : `<button class="btn btn-sm btn-outline-danger" onclick="App.encerrarSessao(${s.id})">
                    Encerrar</button>`}
                </td>
              </tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">Nenhuma sessão ativa.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

App.encerrarSessao = async (id) => {
  try {
    const resp = await api(`/api/auth/sessoes/${id}`, { method: 'DELETE' });
    toast(esc(resp.mensagem));
    minhasSessoes();
  } catch (e) { toast(esc(e.message), 'danger'); }
};

App.encerrarOutrasSessoes = async () => {
  if (!confirm('Encerrar todas as outras sessões abertas?')) return;
  const r = await api('/api/auth/sessoes');
  const outras = r.sessoes.filter(s => !s.atual);
  for (const s of outras) await api(`/api/auth/sessoes/${s.id}`, { method: 'DELETE' }).catch(() => {});
  toast(`${outras.length} sessão(ões) encerrada(s).`);
  minhasSessoes();
};
