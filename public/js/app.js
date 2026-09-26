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

async function api(url, { method = 'GET', body } = {}) {
  const resp = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.erro || 'Erro na requisição.');
  return data;
}

// Requisição multipart (upload de arquivos)
async function apiForm(url, form, method = 'POST') {
  const resp = await fetch(url, { method, body: form });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.erro || 'Erro na requisição.');
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
  relatorios: 'Relatórios'
};

const rotas = { dashboard, clientes, campanhas, medidas, insumos, receitas, precificacao, caixa, relatorios };

async function rotear() {
  const nome = (location.hash.replace(/^#\//, '').split('?')[0]) || 'dashboard';
  const fn = rotas[nome] || rotas.dashboard;
  $$('.sidebar-nav .nav-link').forEach(a => a.classList.toggle('active', a.dataset.rota === nome));
  $('#pageTitle').textContent = TITULOS[nome] || 'Dashboard';
  const sec = $('#content');
  sec.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="spinner-border text-primary-sys" role="status"></div></div>';
  try {
    await fn();
  } catch (e) {
    sec.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', rotear);
document.addEventListener('DOMContentLoaded', () => {
  $('#btnSidebar')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $$('.sidebar-nav .nav-link').forEach(a => a.addEventListener('click', () => $('#sidebar').classList.remove('open')));
  const relogio = $('#clock');
  const tick = () => {
    relogio.textContent = new Date().toLocaleString('pt-BR');
  };
  setInterval(tick, 1000);
  tick();
  rotear();
});

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
        <button class="btn btn-primary btn-sm" onclick="App.novoCliente()"><span class="material-symbols-outlined">add</span> Novo Cliente</button>
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
            <button class="btn btn-primary btn-sm" onclick="App.novaCampanha()"><span class="material-symbols-outlined">add</span> Nova Campanha</button>
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
        <button class="btn btn-primary btn-sm" onclick="App.novaMedida()"><span class="material-symbols-outlined">add</span> Nova Medida</button>
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
        <button class="btn btn-primary btn-sm" onclick="App.novoInsumo()"><span class="material-symbols-outlined">add</span> Novo Insumo</button>
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
        <button class="btn btn-primary btn-sm" onclick="App.novaReceita()"><span class="material-symbols-outlined">add</span> Nova Receita</button>
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
        <button class="btn btn-primary btn-sm" onclick="App.novaPrecificacao()"><span class="material-symbols-outlined">add</span> Nova Precificação</button>
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
        <button class="btn btn-primary btn-sm" onclick="App.novoLancamento()"><span class="material-symbols-outlined">add</span> Novo Lançamento</button>
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

/* disponibilizar objeto global padrão */
window.App = window.App || {};