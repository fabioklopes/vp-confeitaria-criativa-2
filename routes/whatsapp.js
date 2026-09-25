const express = require('express');
const wa = require('../lib/whatsapp');

const router = express.Router();

router.get('/status', async (req, res, next) => {
  try {
    const s = wa.getStatus();
    res.json(s);
  } catch (e) { next(e); }
});

router.get('/qr', async (req, res, next) => {
  try {
    const dataUri = await wa.getQrDataUri();
    if (!dataUri) return res.status(404).json({ erro: 'QR indisponível agora. Verifique o status.' });
    res.json({ qr: dataUri });
  } catch (e) { next(e); }
});

module.exports = router;