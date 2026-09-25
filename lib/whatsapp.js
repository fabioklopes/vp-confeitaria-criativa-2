const path = require('path');
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

function formatErro(e) {
  const msg = (e && e.message) || String(e);
  const stack = (e && e.stack && String(e.stack).replace(/^.*?\n/, '')) || msg;
  return { msg: msg.slice(0, 2000), stack: stack.slice(0, 4000) };
}

let client = null;

function criarClient() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '..', '.wwebjs_auth') }),
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

  client.on('auth_failure', (msg) => {
    state.status = 'auth_failure';
    state.error = String(msg);
    console.error('[whatsapp] falha de autenticação:', msg);
  });

  client.on('ready', () => {
    state.status = 'ready';
    state.qr = null;
    state.lastReady = new Date();
    console.log('[whatsapp] WhatsApp Web conectado e pronto.');
  });

  client.on('disconnected', (reason) => {
    state.status = 'disconnected';
    console.warn('[whatsapp] desconectado:', reason);
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
    state.error = e.message;
    console.error('[whatsapp] erro ao iniciar:', e.message);
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

/* Normaliza telefone brasileiro para formato internacional com código 55.
   Ex.: "(11) 99999-0000" -> "5511999990000@c.us" */
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
    'SELECT id, nome, telefone FROM tb_clientes WHERE whatsapp = 1'
  );
  const numeros = [...new Set(clientes.map(c => normalizarNumero(c.telefone)).filter(Boolean))];
  if (!numeros.length) {
    throw new Error('Nenhum cliente cadastrado com WhatsApp = Sim.');
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
          job.falhas.push({ numero, erro: f.msg.length > 120 ? f.msg.slice(0, 120) : f.msg, detalhe: f });
          console.error(`[whatsapp] falha ao enviar para ${numero}:`, f.msg, '\n', f.stack);
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
      job.falhas.push({ numero: 'sistema', erro: f.msg.slice(0, 120), detalhe: f });
      console.error('[whatsapp] erro no envio da campanha:', f.msg, '\n', f.stack);
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