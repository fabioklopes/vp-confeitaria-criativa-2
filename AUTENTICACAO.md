# Autenticação, Permissões e Segurança

Módulo de autenticação do ERP Confeitaria: login com sessão por cookie, controle de
acesso por permissões, usuários, grupos, perfis, auditoria, recuperação de senha por
e-mail e confirmação de endereço.

---

## 1. Instalação rápida

```bash
cp .env.example .env      # ajuste as senhas do banco e do SMTP
npm install
npm start
```

No primeiro boot o servidor:

1. aplica a migration `migrations/20260926_auth_tb_usuarios.sql` (idempotente);
2. cria o grupo **Administradores** e o perfil **Acesso Total**;
3. cria o administrador definido em `ADMIN_USUARIO` / `ADMIN_SENHA` no `.env`.

Acesse `http://127.0.0.1:3000`. O SPA redireciona para `/login.html` quando não há
sessão válida.

### Outros administradores

```bash
npm run criar-admin -- --usuario.root --senha "NovaSenha@1" --email root@empresa.com --nome "Root"
npm run criar-admin -- --usuario novo.admin --promover     # promove uma conta existente
npm run listar-admins                                     # quem está no grupo Administradores
```

Sem `--senha` o script gera uma senha temporária forte e exige a troca no primeiro acesso.

---

## 2. Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `AUTH_ENABLED` | `true` | Liga a exigência de login em toda a aplicação |
| `APP_URL` | `http://127.0.0.1:3000` | Base dos links de e-mail (recuperação e confirmação) |
| `AUTH_COOKIE` | `erp_sid` | Nome do cookie de sessão |
| `SESSAO_HORAS` | `8` | Duração máxima da sessão |
| `SESSAO_MINUTOS_INATIVIDADE` | `30` | Encerra a sessão após esse tempo sem requisições |
| `LOGIN_MAX_TENTATIVAS` | `5` | Tentativas antes do bloqueio |
| `LOGIN_BLOQUEIO_MINUTOS` | `15` | Duração do bloqueio temporário |
| `RECUPERACAO_MINUTOS` | `30` | Validade do link de recuperação de senha |
| `SENHA_MIN_CARACTERES` | `8` | Tamanho mínimo de senha |
| `ARGON2_*` | 19456 / 2 / 1 | Custo de memória (KiB), iterações e paralelismo |
| `FOTO_MAX_BYTES` | `2097152` | Tamanho máximo da foto de perfil (2 MB) |
| `SMTP_*` | — | Envio dos e-mails (necessário para recuperação de senha) |
| `FORCAR_TROCA_SENHA_ADMIN` | `true` em produção | Exige troca da senha do admin no 1º acesso |

> Os prazos são calculados no **MySQL** (`NOW()`, `DATE_ADD`, `DATE_SUB`) para não
> depender do fuso horário do Node. Se o banco roda em outro fuso, ajuste
> `default-time-zone` do MySQL — a aplicação não converte horários.

### E-mail (Gmail)

1. Em <https://myaccount.google.com/apppasswords> gere uma *senha de app*.
2. Preencha `SMTP_ENABLED=true`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM`.
3. `APP_URL` precisa ser acessível pelo destinatário para o link funcionar.

Sem SMTP a aplicação não quebra: as mensagens caem no console do servidor.

---

## 3. Modelo de permissões

```
usuário  → grupos  → perfis  → permissões
                         ↘ acesso_total = 1 (ignora a lista)
```

- **Perfil**: conjunto de permissões. O perfil *Acesso Total* libera tudo.
- **Grupo**: agrupa perfis, evitando replicar permissões usuário a usuário.
- As permissões efetivas do usuário são a **união** dos perfis de todos os seus grupos.
- Se `acesso_total = 1` anywhere na cadeia, todas as permissões valem.

As permissões são checadas em três camadas:

| Camada | Onde |
| --- | --- |
| Servidor | `auth.exigirPermissao()` / `auth.exigir()` nas rotas |
| Menu | `data-perm` em `public/index.html` + `aplicarPermissoesNoMenu()` |
| Botões | `data-perm-acao` renderizado por `public/js/app.js` |

Ocultar um item no menu **não** é segurança: as rotas da API sempre validam a permissão.

### Permissões por área

| Área | Permissões |
| --- | --- |
| Clientes | `clientes.ver`, `clientes.editar` |
| Campanhas | `campanhas.ver`, `campanhas.editar`, `campanhas.enviar` |
| Medidas | `medidas.ver`, `medidas.editar` |
| Insumos | `insumos.ver`, `insumos.editar` |
| Receitas | `receitas.ver`, `receitas.editar` |
| Precificação | `precificacao.ver`, `precificacao.editar` |
| Caixa | `caixa.ver`, `caixa.editar` |
| Dashboard / Relatórios | `dashboard.ver`, `relatorios.ver` |
| Usuários | `usuarios.ver`, `usuarios.editar` |
| Grupos | `grupos.ver`, `grupos.editar` |
| Perfis | `perfis.ver`, `perfis.editar` |
| Auditoria | `auditoria.ver` |
| WhatsApp | `whatsapp.ver`, `whatsapp.editar` |

O catálogo vive em `lib/permissoes.js` (fonte única para rotas, menu e tela de perfis).

---

## 4. Regras de segurança implementadas

- Senhas com **Argon2id**; hash nunca sai do banco; rehash automático ao alterar parâmetros.
- Token de sessão armazenado apenas como SHA-256; cookie **HttpOnly** + **SameSite=Strict** + Secure em produção.
- Encerramento da sessão por inatividade, logout, troca de senha, bloqueio e desativação do usuário.
- Bloqueio temporário após `LOGIN_MAX_TENTATIVAS`; bloqueio permanente é irreversível.
- Recuperação de senha com token de uso único e resposta **genérica** (não revela se o e-mail existe).
- Todo usuário precisa confirmar o e-mail para poder recuperar a senha.
- Usuário pode editar a própria senha, foto e telefone, mas **não** os próprios
  grupos, perfis, permissões, situação ou e-mail — isso exige outro administrador.
- O **último administrador com acesso total não pode ser rebaixado, bloqueado ou
  excluído** (e nem perder asi próprio o único perfil de acesso total).
- Upload de foto restrito a JPG/PNG/WEBP/GIF até 2 MB, com nome gerado por `crypto.randomUUID`.
- Auditoria de login (sucesso/falha/bloqueio), senha, perfil, grupos, permissões, sessões e ações administrativas.

---

## 5. Fluxos de tela

| Tela | Arquivo |
| --- | --- |
| Login | `public/login.html` + `public/js/login.js` |
| Recuperar senha / redefinir por token | `public/recuperar-senha.html` + `public/js/recuperar-senha.js` |
| Usuários, grupos, perfis, auditoria | `public/index.html` + `public/js/app.js` |
| Meu Perfil, Minhas Sessões | idem (rotas `#/meu-perfil` e `#/sessoes`) |

Regras de navegação:

- Sessão inválida/expirada → redireciona para `/login.html?motivo=expirada`.
- Usuário **sem** `dashboard.ver` cai na primeira tela liberada do menu.
- Usuário que digita uma tela **sem** permissão vê "Acesso negado" com link para uma
  tela autorizada — nunca um redirecionamento silencioso.
- A troca de senha obrigatória abre um modal bloqueante antes de qualquer tela.

---

## 6. Banco de dados

```bash
# estrutura completa (inclui o módulo de autenticação)
mysql -u root -p < sql/schema.sql

# ou apenas a migration de autenticação
mysql -u root -p db_confeitaria_v2 < migrations/20260926_auth_tb_usuarios.sql
```

| Tabela | Função |
| --- | --- |
| `tb_usuarios` | contas, hash, situação, bloqueio, foto, e-mail verificado |
| `tb_grupos` / `tb_perfis` | agrupamento de permissões |
| `tb_usuarios_grupos` / `tb_grupos_perfis` / `tb_perfis_permissoes` | vínculos |
| `tb_sessoes` | hash do token, IP, user-agent, último acesso |
| `tb_tokens_acesso` | tokens de recuperação e verificação de e-mail |
| `tb_log_acesso` | auditoria |
| `tb_log_requisicoes` | requisições que falharam (4xx/5xx) |

As tabelas de vínculo usam chave primária composta (`usuario_id, grupo_id`,
`grupo_id, perfil_id`, `perfil_id, permissao_id`), o que impede vínculos duplicados.
Os `ON DELETE CASCADE` mantêm as tabelas filhas íntegras ao excluir um registro.

---

## 7. Arquivos principais

| Arquivo | Responsabilidade |
| --- | --- |
| `lib/auth.js` | sessões, tokens, permissões, middlewares, auditoria |
| `lib/senha.js` | Argon2id, política e senha temporária forte |
| `lib/mailer.js` | SMTP com fallback para console e templates |
| `lib/foto.js` | upload/remoção de avatares |
| `lib/permissoes.js` | catálogo de permissões e rótulos |
| `lib/garantir-schema.js` | aplicação da migration e admin inicial |
| `routes/auth.js` | login, logout, perfil, sessões, recuperação |
| `routes/usuarios.js` | CRUD de usuários, grupos, foto, bloqueio, senhas |
| `routes/grupos.js`, `routes/perfis.js`, `routes/auditoria.js` | telas de segurança |
| `scripts/criar-administrador.js` | cria/promove administradores |
