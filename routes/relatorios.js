const express = require('express');
const db = require('../db');
const config = require('../config');
const PDFDocument = require('pdfkit');

const router = express.Router();

function money(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function num(v, inteiro = false, d = 3) {
  return Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: inteiro ? 0 : d
  });
}
function data(v) {
  if (!v) return '-';
  return String(v).split(' ')[0].split('-').reverse().join('/');
}
function dataHora(v) {
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString('pt-BR');
}

function novoDoc({ titulo, subtitulo }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: titulo }
  });
  const top = doc.page.margins.top;
  doc.fillColor('#8e44ad');
  doc.rect(top, top, doc.page.width - 80, 60).fill();
  doc.fillColor('#ffffff')
    .font('Helvetica-Bold').fontSize(16)
    .text(config.app.nomeSistema, 40, 52);
  doc.font('Helvetica').fontSize(11)
    .text(titulo, 40, 72);
  doc.fillColor('#888888').fontSize(8).font('Helvetica')
    .text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 40, 87);
  doc.moveTo(40, 110).lineTo(doc.page.width - 40, 110).strokeColor('#dddddd').stroke();
  doc.moveDown(2);
  return doc;
}

function wrapLines(doc, text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (doc.widthOfString(test) > width) {
      if (cur) { lines.push(cur); cur = w; }
      else { lines.push(w); }
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function tabela(doc, headers, widths, rows, options = {}) {
  const cellPad = 5;
  const headerFill = '#2c3e50';
  let y = options.y0 || doc.y;

  const rowHeight = (cells) => {
    let h = 18;
    cells.forEach((txt, c) => {
      const lines = wrapLines(doc, txt, (widths[c] || 60) - cellPad * 2).length;
      h = Math.max(h, lines * (options.fontSize || 9) * 1.35 + 8);
    });
    return h;
  };

  const drawRow = (cells, fill) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = 40;
      drawRow(headers, headerFill);
      return;
    }
    const h = rowHeight(cells);
    let x = 40;
    for (let c = 0; c < cells.length; c++) {
      doc.rect(x, y, widths[c], h).fill(fill);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(options.fontSize || 9)
        .text(String(cells[c]), x + cellPad, y + 4, { width: widths[c] - cellPad * 2 });
      x += widths[c];
    }
    y += h;
  };

  const drawBody = (cells, fill) => {
    const h = rowHeight(cells);
    if (y + h > doc.page.height - 50) {
      doc.addPage();
      y = 40;
      drawRow(headers, headerFill);
    }
    let x = 40;
    for (let c = 0; c < cells.length; c++) {
      doc.rect(x, y, widths[c], h).fill(fill);
      doc.fillColor('#333333').font('Helvetica').fontSize(options.fontSize || 9)
        .text(String(cells[c]), x + cellPad, y + 4, { width: widths[c] - cellPad * 2 });
      x += widths[c];
    }
    y += h;
  };

  drawRow(headers, headerFill);
  let zebra = true;
  for (const r of rows) {
    drawBody(r, zebra ? '#f4f4f4' : '#ffffff');
    zebra = !zebra;
  }
  doc.y = y;
  return doc;
}

async function gerarCliente(doc, cliente) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#333333').text(cliente.nome);
  doc.moveDown(0.2);
  const info = [
    ['CPF/CNPJ', cliente.cpf_cnpj || '-'],
    ['Telefone', (cliente.telefone || '-') + (cliente.whatsapp ? ' (WhatsApp)' : '')],
    ['E-mail', cliente.email || '-'],
    ['Endereço', [cliente.endereco, cliente.bairro].filter(Boolean).join(' - ') || '-'],
    ['CEP', cliente.cep || '-'],
    ['Cadastro em', dataHora(cliente.created_at)]
  ];
  doc.font('Helvetica').fontSize(10).fillColor('#555555');
  for (const [k, v] of info) {
    doc.fillColor('#888888').text(`${k}:`, { continued: true });
    doc.fillColor('#333333').text(` ${v}`);
  }
  doc.moveDown();
}

router.get('/clientes.pdf', async (req, res, next) => {
  try {
    const rows = await db.query('SELECT * FROM tb_clientes ORDER BY nome');
    const doc = novoDoc({ titulo: 'Relatório de Clientes' });
    doc.font('Helvetica-Bold').fontSize(12).text('Relação de Clientes', 40, 125);
    doc.font('Helvetica').fontSize(10).text(`Total de clientes cadastrados: ${rows.length}`, 40, 141);
    doc.y = 155;
    if (!rows.length) doc.text('Nenhum cliente cadastrado.', 40, 160).fillColor('#888888');
    for (const c of rows) { await gerarCliente(doc, c); }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="clientes-${Date.now()}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { next(e); }
});

router.get('/insumos.pdf', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT i.*, m.descricao AS medida, m.inteiro, ROUND(i.valor / NULLIF(i.quantidade_compra, 0), 4) AS custo_unitario
       FROM tb_insumos i LEFT JOIN tb_medidas m ON m.id = i.medida_id ORDER BY i.produto`
    );
    const doc = novoDoc({ titulo: 'Relatório de Insumos' });
    doc.moveDown();
    const headers = ['Produto', 'Qtd. Compra', 'Medida', 'Valor', 'Custo Unit.'];
    const widths = [180, 80, 70, 90, 90];
    const tr = rows.map((r) => [
      r.produto, num(r.quantidade_compra, r.inteiro), r.medida || '-', money(r.valor), money(r.custo_unitario)
    ]);
    tabela(doc, headers, widths, tr, { fontSize: 9 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="insumos-${Date.now()}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { next(e); }
});

router.get('/receitas.pdf', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT r.id, r.nome, r.created_at,
        COALESCE(SUM(ri.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))), 0) AS custo
       FROM tb_receitas r
       LEFT JOIN tb_receita_itens ri ON ri.receita_id = r.id
       LEFT JOIN tb_insumos i ON i.id = ri.insumo_id
       GROUP BY r.id ORDER BY r.nome`
    );
    const doc = novoDoc({ titulo: 'Relatório de Receitas Prontas' });
    doc.moveDown();
    for (const r of rows) {
      doc.fillColor('#8e44ad').font('Helvetica-Bold').fontSize(11).text(r.nome);
      doc.fillColor('#333333').font('Helvetica').fontSize(9)
        .text(`Custo calculado: ${money(r.custo)}  |  Cadastro: ${dataHora(r.created_at)}`);
      const itens = await db.query(
        `SELECT ri.quantidade, i.produto, m.descricao AS medida, m.inteiro,
           (ri.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))) AS sub
         FROM tb_receita_itens ri
         JOIN tb_insumos i ON i.id = ri.insumo_id
         LEFT JOIN tb_medidas m ON m.id = i.medida_id
         WHERE ri.receita_id = ? ORDER BY ri.id`, [r.id]
      );
      if (itens.length) {
        tabela(doc, ['Insumo', 'Qtd', 'Medida', 'Custo'],
          [250, 80, 80, 100],
          itens.map((it) => [it.produto, num(it.quantidade, it.inteiro), it.medida || '-', money(it.sub)]),
          { fontSize: 9 }
        );
      }
      doc.moveDown(0.8);
    }
    if (!rows.length) doc.fillColor('#888888').text('Nenhuma receita cadastrada.', 40, 125);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receitas-${Date.now()}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { next(e); }
});

router.get('/precificacao.pdf', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT p.id, p.nome, p.descricao,
        COALESCE(SUM(
          CASE WHEN pi.tipo = 'insumo'
            THEN pi.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))
            ELSE pi.quantidade * (
              SELECT COALESCE(SUM(ri.quantidade * (j.valor / NULLIF(j.quantidade_compra, 0))), 0)
              FROM tb_receita_itens ri JOIN tb_insumos j ON j.id = ri.insumo_id
              WHERE ri.receita_id = pi.receita_id
            )
          END
        ), 0) AS valor
       FROM tb_precificacao p
       LEFT JOIN tb_precificacao_itens pi ON pi.precificacao_id = p.id
       LEFT JOIN tb_insumos i ON i.id = pi.insumo_id
       GROUP BY p.id ORDER BY p.nome`
    );
    const doc = novoDoc({ titulo: 'Relatório de Precificação' });
    doc.moveDown();
    for (const p of rows) {
      doc.fillColor('#8e44ad').font('Helvetica-Bold').fontSize(11).text(p.nome);
      if (p.descricao) doc.fillColor('#666666').font('Helvetica').fontSize(9).text(p.descricao);
      doc.fillColor('#333333').font('Helvetica-Bold').fontSize(10)
        .text(`Valor calculado: ${money(p.valor)}`);
      const itens = await db.query(
        `SELECT pi.tipo, pi.quantidade, i.produto, r.nome AS receita_nome, m.inteiro,
           CASE WHEN pi.tipo = 'insumo'
             THEN pi.quantidade * (i.valor / NULLIF(i.quantidade_compra, 0))
             ELSE pi.quantidade * (
               SELECT COALESCE(SUM(ri.quantidade * (j.valor / NULLIF(j.quantidade_compra, 0))), 0)
               FROM tb_receita_itens ri JOIN tb_insumos j ON j.id = ri.insumo_id
               WHERE ri.receita_id = pi.receita_id)
           END AS sub
         FROM tb_precificacao_itens pi
         LEFT JOIN tb_insumos i ON i.id = pi.insumo_id
         LEFT JOIN tb_medidas m ON m.id = i.medida_id
         LEFT JOIN tb_receitas r ON r.id = pi.receita_id
         WHERE pi.precificacao_id = ? ORDER BY pi.id`, [p.id]
      );
      if (itens.length) {
        tabela(doc, ['Item', 'Tipo', 'Qtd', 'Custo'],
          [230, 80, 80, 110],
          itens.map((it) => [
            it.tipo === 'insumo' ? it.produto : it.receita_nome,
            it.tipo === 'insumo' ? 'Insumo' : 'Receita',
            num(it.quantidade, it.inteiro), money(it.sub)
          ]),
          { fontSize: 9 }
        );
      }
      doc.moveDown(0.8);
    }
    if (!rows.length) doc.fillColor('#888888').text('Nenhuma precificação cadastrada.', 40, 125);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="precificacao-${Date.now()}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { next(e); }
});

router.get('/campanhas.pdf', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT id, nome, descricao, DATE_FORMAT(data_inicio, "%d/%m/%Y") data_inicio,
        DATE_FORMAT(data_termino, "%d/%m/%Y") data_termino, created_at
       FROM tb_capanhas ORDER BY data_inicio DESC`
    );
    const doc = novoDoc({ titulo: 'Relatório de Campanhas' });
    doc.moveDown();
    const headers = ['Campanha', 'Início', 'Término', 'Descrição'];
    const widths = [150, 70, 70, 250];
    const tr = rows.map((r) => [r.nome, r.data_inicio, r.data_termino, r.descricao || '-']);
    tabela(doc, headers, widths, tr, { fontSize: 9 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="campanhas-${Date.now()}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { next(e); }
});

router.get('/caixa.pdf', async (req, res, next) => {
  try {
    const { inicio, fim } = req.query;
    const params = [];
    let where = '1=1';
    if (inicio) { where += ' AND data_lancamento >= ?'; params.push(inicio); }
    if (fim) { where += ' AND data_lancamento <= ?'; params.push(fim); }
    const rows = await db.query(
      `SELECT tipo, descricao, valor, DATE_FORMAT(data_lancamento, "%d/%m/%Y") data_lancamento
       FROM tb_caixa WHERE ${where} ORDER BY data_lancamento, id`, params
    );
    const [tot] = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) AS e,
        COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) AS s,
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0) AS saldo
       FROM tb_caixa WHERE ${where}`, params
    );
    const doc = novoDoc({ titulo: 'Relatório de Fluxo de Caixa' });
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#333333')
      .text(`Período: ${inicio ? data(inicio) : '__/__/____'} a ${fim ? data(fim) : '__/__/____'}`, 40, 125);
    doc.y = 140;
    const headers = ['Data', 'Tipo', 'Descrição', 'Valor'];
    const widths = [80, 80, 250, 100];
    const tr = rows.map((r) => [
      r.data_lancamento,
      r.tipo === 'entrada' ? 'Entrada' : 'Saída',
      r.descricao,
      (r.tipo === 'entrada' ? '+ ' : '- ') + money(r.valor)
    ]);
    tabela(doc, headers, widths, tr, { fontSize: 9 });
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333')
      .text(`Entradas: ${money(tot.e)}      Saídas: ${money(tot.s)}      Saldo: ${money(tot.saldo)}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fluxo-de-caixa-${Date.now()}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { next(e); }
});

module.exports = router;