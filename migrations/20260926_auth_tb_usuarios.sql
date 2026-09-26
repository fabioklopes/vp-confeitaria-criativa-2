-- ============================================================
-- ERP Confeitaria - Módulo de Autenticação e Controle de Acesso
-- Tabela principal: tb_usuarios
-- ============================================================
-- Este arquivo é idempotente: pode ser aplicado quantas vezes for
-- necessário (o servidor executa automaticamente ao iniciar).
-- ============================================================

-- ------------------------------------------------------------
-- PERMISSÕES (catálogo de telas/ações disponíveis no sistema)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tb_permissoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chave VARCHAR(80) NOT NULL COMMENT 'identificador usado no código, ex.: clientes.editar',
  modulo VARCHAR(40) NOT NULL COMMENT 'agrupador exibido na tela de perfis',
  rotulo VARCHAR(120) NOT NULL COMMENT 'descrição exibida ao usuário',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_permissao_chave (chave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- PERFIS DE ACESSO (conjunto de permissões)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tb_perfis (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(80) NOT NULL,
  descricao VARCHAR(255),
  acesso_total TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = ignora a lista de permissões (acesso irrestrito)',
  sistema TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = perfil nativo, não pode ser excluído',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_perfil_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tb_perfis_permissoes (
  perfil_id INT NOT NULL,
  permissao_id INT NOT NULL,
  PRIMARY KEY (perfil_id, permissao_id),
  CONSTRAINT fk_pperfil_perfil FOREIGN KEY (perfil_id)
    REFERENCES tb_perfis(id) ON DELETE CASCADE,
  CONSTRAINT fk_pperfil_permissao FOREIGN KEY (permissao_id)
    REFERENCES tb_permissoes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- GRUPOS DE USUÁRIOS (usuário herda os perfis de seus grupos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tb_grupos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(80) NOT NULL,
  descricao VARCHAR(255),
  sistema TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = grupo nativo, não pode ser excluído',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_grupo_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tb_grupos_perfis (
  grupo_id INT NOT NULL,
  perfil_id INT NOT NULL,
  PRIMARY KEY (grupo_id, perfil_id),
  CONSTRAINT fk_gperfil_grupo FOREIGN KEY (grupo_id)
    REFERENCES tb_grupos(id) ON DELETE CASCADE,
  CONSTRAINT fk_gperfil_perfil FOREIGN KEY (perfil_id)
    REFERENCES tb_perfis(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- USUÁRIOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tb_usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  usuario VARCHAR(60) NOT NULL COMMENT 'login de acesso ao sistema',
  email VARCHAR(190) NOT NULL COMMENT 'e-mail de preferência (recebe reset de senha)',
  telefone VARCHAR(30),
  cargo VARCHAR(120),
  foto VARCHAR(255) NULL COMMENT 'caminho relativo em upload/usuarios',
  senha_hash VARCHAR(255) NOT NULL COMMENT 'hash Argon2id',
  senha_alterada_em DATETIME NULL,
  deve_alterar_senha TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = obriga a troca no próximo acesso',
  email_verificado TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = e-mail confirmado por link enviado',
  situacao ENUM('ativo','bloqueado') NOT NULL DEFAULT 'ativo',
  bloqueado_em DATETIME NULL,
  bloqueado_motivo VARCHAR(255),
  tentativas_falhas TINYINT NOT NULL DEFAULT 0,
  bloqueio_ate DATETIME NULL COMMENT 'bloqueio temporário por tentativas de login',
  ultimo_acesso DATETIME NULL,
  ultimo_ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_usuario_login (usuario),
  UNIQUE KEY uk_usuario_email (email),
  KEY ix_usuario_situacao (situacao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tb_usuarios_grupos (
  usuario_id INT NOT NULL,
  grupo_id INT NOT NULL,
  PRIMARY KEY (usuario_id, grupo_id),
  CONSTRAINT fk_ugrupo_usuario FOREIGN KEY (usuario_id)
    REFERENCES tb_usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ugrupo_grupo FOREIGN KEY (grupo_id)
    REFERENCES tb_grupos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- SESSÕES (cookie httpOnly; apenas o hash do token é gravado)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tb_sessoes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 do token enviado no cookie',
  usuario_id INT NOT NULL,
  ip VARCHAR(45),
  user_agent VARCHAR(255),
  expira_em DATETIME NOT NULL,
  revogada_em DATETIME NULL,
  ultimo_acesso DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sessao_token (token_hash),
  KEY ix_sessao_usuario (usuario_id),
  CONSTRAINT fk_sessao_usuario FOREIGN KEY (usuario_id)
    REFERENCES tb_usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- TOKENS DE ACESSO (recuperação de senha e verificação de e-mail)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tb_tokens_acesso (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 do token enviado por e-mail',
  usuario_id INT NOT NULL,
  tipo ENUM('recuperacao','verificacao_email') NOT NULL,
  expira_em DATETIME NOT NULL,
  usado_em DATETIME NULL,
  criado_ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_token_hash (token_hash),
  KEY ix_token_usuario (usuario_id, tipo),
  CONSTRAINT fk_token_usuario FOREIGN KEY (usuario_id)
    REFERENCES tb_usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- LOG DE ACESSO E AUDITORIA
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tb_log_acesso (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL COMMENT 'nulo quando o evento não partiu de um usuário autenticado',
  usuario_nome VARCHAR(150) COMMENT 'copia do nome/login no momento do evento',
  evento VARCHAR(60) NOT NULL,
  descricao VARCHAR(500),
  sucesso TINYINT(1) NOT NULL DEFAULT 1,
  ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY ix_log_usuario (usuario_id),
  KEY ix_log_evento (evento),
  KEY ix_log_data (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Catálogo de permissões
-- ------------------------------------------------------------
INSERT INTO tb_permissoes (chave, modulo, rotulo) VALUES
  ('dashboard.ver',        'Dashboard',      'Ver o dashboard'),
  ('clientes.ver',         'Cadastros',      'Ver clientes'),
  ('clientes.editar',      'Cadastros',      'Criar, editar e excluir clientes'),
  ('campanhas.ver',        'Cadastros',      'Ver campanhas'),
  ('campanhas.editar',     'Cadastros',      'Criar, editar e excluir campanhas'),
  ('campanhas.enviar',     'Cadastros',      'Enviar campanhas pelo WhatsApp'),
  ('medidas.ver',          'Cadastros',      'Ver medidas'),
  ('medidas.editar',       'Cadastros',      'Criar, editar e excluir medidas'),
  ('insumos.ver',          'Produção',       'Ver insumos'),
  ('insumos.editar',       'Produção',       'Criar, editar e excluir insumos'),
  ('receitas.ver',         'Produção',       'Ver receitas prontas'),
  ('receitas.editar',      'Produção',       'Criar, editar e excluir receitas prontas'),
  ('precificacao.ver',     'Produção',       'Ver precificação'),
  ('precificacao.editar',  'Produção',       'Criar, editar e excluir precificações'),
  ('caixa.ver',            'Financeiro',     'Ver fluxo de caixa'),
  ('caixa.editar',         'Financeiro',     'Criar, editar e excluir lançamentos'),
  ('relatorios.ver',       'Relatórios',     'Gerar e baixar relatórios em PDF'),
  ('whatsapp.ver',         'Sistema',        'Ver o status da conexão do WhatsApp'),
  ('usuarios.ver',         'Segurança',      'Ver usuários'),
  ('usuarios.editar',      'Segurança',      'Criar, editar, bloquear e excluir usuários'),
  ('grupos.ver',           'Segurança',      'Ver grupos de usuários'),
  ('grupos.editar',        'Segurança',      'Criar, editar e excluir grupos'),
  ('perfis.ver',           'Segurança',      'Ver perfis de acesso'),
  ('perfis.editar',        'Segurança',      'Criar, editar e excluir perfis de acesso'),
  ('auditoria.ver',        'Segurança',      'Ver o log de acessos e auditoria')
ON DUPLICATE KEY UPDATE modulo = VALUES(modulo), rotulo = VALUES(rotulo);

-- ------------------------------------------------------------
-- Perfil nativo de acesso irrestrito
-- ------------------------------------------------------------
INSERT INTO tb_perfis (nome, descricao, acesso_total, sistema)
VALUES ('Acesso Total', 'Libera todas aspermissões do sistema, sem restrições.', 1, 1)
ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), acesso_total = 1, sistema = 1;

-- ------------------------------------------------------------
-- Grupo nativo de administradores
-- ------------------------------------------------------------
INSERT INTO tb_grupos (nome, descricao, sistema)
VALUES ('Administradores', 'Grupo padrão do administrador do sistema.', 1)
ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), sistema = 1;

-- O grupo Administradores recebe o perfil de Acesso Total
INSERT IGNORE INTO tb_grupos_perfis (grupo_id, perfil_id)
SELECT g.id, p.id FROM tb_grupos g, tb_perfis p
WHERE g.nome = 'Administradores' AND p.nome = 'Acesso Total';
