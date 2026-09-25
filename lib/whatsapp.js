const fs = require('fs');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const config = require('../config');
const db = require('../db');

/* ============================================================
   WhatsApp Web - sessão real (LocalAuth) com regras anti-banimento
   ============================================================ */

const state = {
  status: 'disconnected', // disconnected | loading | qr | authenticated | ready | auth_failure
  qr: null,
  lastReady: null,
  client: null,
  error: null
};

const ativos = new Map(); // campanha_id -> job {total, enviados, falhas, concluido, cancelado}
let enviadoHoje = 0;
let diaHoje = new Date().toDateString();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function mascararNumero(numero) {
  const value = String(numero || '');
  if (value === 'sistema') return value;
  const domain = value.split('@')[1];
  return domain ? `oculto@${domain}` : 'oculto';
}

function formatErro(e) {
  return e && e.code ? String(e.code).slice(0, 120) : 'falha_envio';
}

let client = null;

function criarClient() {
  fs.mkdirSync(config.whatsapp.dataPath, { recursive: true, mode: 0o700 });
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.whatsapp.dataPath }),
    puppeteer: {
      headless: true,
      executablePath: config.whatsapp.chromePath,
      args: config.whatsapp.chromeArgs
    }
  });

  client.on('loading_screen', () => {
    state.status = 'loading';
    state.qr = null;
  });

  client.on('qr', qr => {
    state.status = 'qr';
    state.qr = qr;
  });

  client.on('authenticated', () => {
    state.status = 'authenticated';
  });

  client.on('auth_failure', () => {
    state.status = 'auth_failure';
    state.error = 'Falha de autenticação do WhatsApp.';
    console.error('[whatsapp] falha de autenticação.');
  });

  client.on('ready', () => {
    state.status = 'ready';
    state.qr = null;
    state.lastReady = new Date();
    console.log('[whatsapp] WhatsApp Web conectado e pronto.');
  });

  client.on('disconnected', () => {
    state.status = 'disconnected';
    state.error = null;
    console.warn('[whatsapp] desconectado.');
  });

  client.initialize();
}

function init() {
  if (!config.whatsapp.enabled) {
    state.status = 'disabled';
    return;
  }
  if (client) return;
  try {
    criarClient();
  } catch (e) {
    state.status = 'error';
    state.error = 'Falha ao iniciar o WhatsApp.';
    console.error('[whatsapp] erro ao iniciar:', e.name || 'erro');
  }
}

function getStatus() {
  return {
    status: state.status,
    error: state.error,
    ultimaConexao: state.lastReady,
    ativos: [...ativos.values()].filter(j => !j.concluido).length
  };
}

async function getQrDataUri() {
  if (state.status !== 'qr' || !state.qr) return null;
  return await qrcode.toDataURL(state.qr);
}

function isReady() {
  return state.status === 'ready';
}

/* Normaliza telefone brasileiro para formato internacional com código 55. */
function normalizarNumero(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  d = d.replace(/^0+/, '');
  if (!/^[1-9]/.test(d)) return null;
  if ((d.length === 12 && d.startsWith('55')) || d.length === 13 && d.startsWith('55')) {
    return d + '@c.us';
  }
  if (d.length === 10) return '55' + d + '@c.us';
  if (d.length === 11) return '55' + d + '@c.us';
  if (d.length === 12) return d + '@c.us';
  return null;
}

async function enviarCampanha(campanhaId, mediaPath, descricao) {
  if (ativos.has(Number(campanhaId))) {
    throw new Error('Já existe um envio em andamento para esta campanha.');
  }
  if (!isReady()) {
    throw new Error('WhatsApp Web não está conectado. Escaneie o QR Code para conectar.');
  }

  const clientes = await db.query(
    'SELECT id, nome, telefone FROM tb_clientes WHERE whatsapp = 1 AND desabilitar_whatsapp = 0'
  );
  const numeros = [...new Set(clientes.map(c => normalizarNumero(c.telefone)).filter(Boolean))];
  if (!numeros.length) {
    throw new Error('Nenhum cliente cadastrado com WhatsApp habilitado para campanhas.');
  }

  if (new Date().toDateString() !== diaHoje) {
    diaHoje = new Date().toDateString();
    enviadoHoje = 0;
  }
  const restanteHoje = Math.max(0, config.whatsapp.diarioMax - enviadoHoje);
  if (!restanteHoje) {
    throw new Error('Teto diário de mensagens atingido (' + config.whatsapp.diarioMax + ').');
  }
  const fila = numeros.slice(0, restanteHoje);

  const media = MessageMedia.fromFilePath(mediaPath);

  const job = {
    campanha_id: Number(campanhaId),
    total: fila.length,
    totalCadastro: numeros.length,
    enviados: 0,
    falhas: [],
    concluido: false,
    cancelado: false,
    iniciado: new Date()
  };
  ativos.set(job.campanha_id, job);

  // envio sequencial fora do loop da requisição (não bloqueia a API)
  setImmediate(async () => {
    try {
      for (let i = 0; i < fila.length && !job.cancelado; i++) {
        const numero = fila[i];
        try {
          await client.sendMessage(numero, media, {
            caption: descricao || '',
            sendMediaAsDocument: media.mimetype === 'application/pdf'
          });
          job.enviados++;
          enviadoHoje++;
        } catch (e) {
          const f = formatErro(e);
          job.falhas.push({ numero: mascararNumero(numero), erro: f });
          console.error('[whatsapp] falha ao enviar mensagem:', f);
        }

        if (i < fila.length - 1 && !job.cancelado) {
          const pausaLonga = (i + 1) % config.whatsapp.batchSize === 0;
          const espera = pausaLonga
            ? randomDelay(config.whatsapp.pauseMinMs, config.whatsapp.pauseMaxMs)
            : randomDelay(config.whatsapp.delayMinMs, config.whatsapp.delayMaxMs);
          await sleep(espera);
        }
      }
    } catch (e) {
      const f = formatErro(e);
      job.falhas.push({ numero: 'sistema', erro: f });
      console.error('[whatsapp] erro no envio da campanha:', f);
    } finally {
      job.concluido = true;
    }
  });

  return {
    campanha_id: job.campanha_id,
    total: job.total,
    totalCadastro: job.totalCadastro,
    mensagem: `Envio iniciado para ${job.total} número(s) via WhatsApp Web.`
  };
}

function getProgresso(campanhaId) {
  const job = ativos.get(Number(campanhaId));
  if (!job) return null;
  return {
    campanha_id: job.campanha_id,
    total: job.total,
    enviados: job.enviados,
    falhas: job.falhas,
    concluido: job.concluido,
    cancelado: job.cancelado,
    iniciado: job.iniciado,
    percentual: job.total ? Math.round((job.enviados / job.total) * 100) : 0
  };
}

function cancelar(campanhaId) {
  const job = ativos.get(Number(campanhaId));
  if (!job) return false;
  job.cancelado = true;
  return true;
}

module.exports = { init, getStatus, getQrDataUri, isReady, enviarCampanha, getProgresso, cancelar, normalizarNumero };