/* ============================================================
   Catálogo de permissões do sistema.
   Fonte única de verdade: o mesmo seed está em
   migrations/20260926_auth_tb_usuarios.sql
   ============================================================ */
'use strict';

// Módulos exibidos nas telas, na ordem em que devem aparecer
const MODULOS = [
  'Dashboard',
  'Cadastros',
  'Produção',
  'Financeiro',
  'Relatórios',
  'Sistema',
  'Segurança'
];

// [chave, módulo, rótulo]
const PERMISSOES = [
  ['dashboard.ver', 'Dashboard', 'Ver o dashboard'],
  ['clientes.ver', 'Cadastros', 'Ver clientes'],
  ['clientes.editar', 'Cadastros', 'Criar, editar e excluir clientes'],
  ['campanhas.ver', 'Cadastros', 'Ver campanhas'],
  ['campanhas.editar', 'Cadastros', 'Criar, editar e excluir campanhas'],
  ['campanhas.enviar', 'Cadastros', 'Enviar campanhas pelo WhatsApp'],
  ['medidas.ver', 'Cadastros', 'Ver medidas'],
  ['medidas.editar', 'Cadastros', 'Criar, editar e excluir medidas'],
  ['insumos.ver', 'Produção', 'Ver insumos'],
  ['insumos.editar', 'Produção', 'Criar, editar e excluir insumos'],
  ['receitas.ver', 'Produção', 'Ver receitas prontas'],
  ['receitas.editar', 'Produção', 'Criar, editar e excluir receitas prontas'],
  ['precificacao.ver', 'Produção', 'Ver precificação'],
  ['precificacao.editar', 'Produção', 'Criar, editar e excluir precificações'],
  ['caixa.ver', 'Financeiro', 'Ver fluxo de caixa'],
  ['caixa.editar', 'Financeiro', 'Criar, editar e excluir lançamentos'],
  ['relatorios.ver', 'Relatórios', 'Gerar e baixar relatórios em PDF'],
  ['whatsapp.ver', 'Sistema', 'Ver o status da conexão do WhatsApp'],
  ['usuarios.ver', 'Segurança', 'Ver usuários'],
  ['usuarios.editar', 'Segurança', 'Criar, editar, bloquear e excluir usuários'],
  ['grupos.ver', 'Segurança', 'Ver grupos de usuários'],
  ['grupos.editar', 'Segurança', 'Criar, editar e excluir grupos'],
  ['perfis.ver', 'Segurança', 'Ver perfis de acesso'],
  ['perfis.editar', 'Segurança', 'Criar, editar e excluir perfis de acesso'],
  ['auditoria.ver', 'Segurança', 'Ver o log de acessos e auditoria']
];

// Permissão mínima para enxergar cada tela do menu lateral
const PERMISSAO_TELA = {
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

const CHAVES = PERMISSOES.map(([chave]) => chave);

function chaveValida(chave) {
  return CHAVES.includes(chave);
}

// Lista agrupada por módulo (usada na tela de perfis de acesso)
function agrupadas() {
  return MODULOS.map(modulo => ({
    modulo,
    permissoes: PERMISSOES
      .filter(([, m]) => m === modulo)
      .map(([chave, , rotulo]) => ({ chave, rotulo }))
  })).filter(grupo => grupo.permissoes.length);
}

module.exports = { MODULOS, PERMISSOES, CHAVES, PERMISSAO_TELA, chaveValida, agrupadas };
