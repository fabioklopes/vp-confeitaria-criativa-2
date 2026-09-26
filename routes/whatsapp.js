const express = require('express');
const wa = require('../lib/whatsapp');
const auth = require('../lib/auth');

const router = express.Router();

router.use(auth.exigirLogin, auth.exigirPermissao('whatsapp.ver'));

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