ALTER TABLE tb_clientes
  ADD COLUMN desabilitar_whatsapp TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '1 = não receber campanhas via WhatsApp'
  AFTER whatsapp;
