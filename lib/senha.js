/* ============================================================
   Senhas - criptografia Argon2id
   ============================================================ */
'use strict';

const crypto = require('crypto');
const argon2 = require('argon2');
const config = require('../config');

const { argon2: parametros } = config.auth;

const OPCOES = {
  type: argon2.argon2id,
  memoryCost: parametros.memoryCost,
  timeCost: parametros.timeCost,
  parallelism: parametros.parallelism
};

// Gera o hash Argon2id no formato PHC ($argon2id$v=19$m=...,t=...,p=...$salt$hash)
async function gerarHash(senha) {
  return argon2.hash(senha, OPCOES);
}

// Confere a senha contra o hash. Nunca lança erro: hash inválido
// ou corrompido simplesmente resulta em "não confere".
async function conferir(hash, senha) {
  if (!hash || typeof senha !== 'string' || senha === '') return false;
  try {
    return await argon2.verify(hash, senha);
  } catch (e) {
    return false;
  }
}

// Indica se o hash foi gerado com parâmetros mais fracos que os
// configurados agora -> o hash deve ser refeito no próximo login.
async function precisaRehash(hash) {
  try {
    return await argon2.needsRehash(hash, OPCOES);
  } catch (e) {
    return true;
  }
}

/* ------------------------------------------------------------
   Política de senha
   Retorna null quando válida, ou a mensagem de erro em pt-BR.
   ------------------------------------------------------------ */
function validarPolitica(senha) {
  const minimo = config.auth.senhaMinCaracteres;
  if (typeof senha !== 'string' || senha.length < minimo) {
    return `A senha deve ter no mínimo ${minimo} caracteres.`;
  }
  if (senha.length > 200) {
    return 'A senha deve ter no máximo 200 caracteres.';
  }
  if (!/[A-Za-zÀ-ÿ]/.test(senha)) {
    return 'A senha deve conter ao menos uma letra.';
  }
  if (!/\d/.test(senha)) {
    return 'A senha deve conter ao menos um número.';
  }
  return null;
}

// Senha aleatória forte, usada em redefinições feitas pelo admin.
// Evita caracteres ambíguos (0/O, 1/l/I) para facilitar a digitação.
const MAIUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const ALFABETO = MAIUSCULAS + MINUSCULAS + DIGITOS;
const SIMBOLOS = '!@#$%&*?-_';

function embaralhar(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

// Garante ao menos uma maiúscula, uma minúscula, um número e um símbolo,
// para que a senha sorteada sempre passe em validarPolitica().
function senhaTemporaria(tamanho = 12) {
  const total = Math.max(tamanho, 8);
  const obrigatorias = [
    MAIUSCULAS[crypto.randomInt(MAIUSCULAS.length)],
    MINUSCULAS[crypto.randomInt(MINUSCULAS.length)],
    DIGITOS[crypto.randomInt(DIGITOS.length)],
    SIMBOLOS[crypto.randomInt(SIMBOLOS.length)]
  ];
  const resto = Array.from(
    { length: total - obrigatorias.length },
    () => ALFABETO[crypto.randomInt(ALFABETO.length)]
  );
  return embaralhar([...obrigatorias, ...resto]).join('');
}

module.exports = { gerarHash, conferir, precisaRehash, validarPolitica, senhaTemporaria, OPCOES };
