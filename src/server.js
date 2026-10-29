const app = require('./app');
const { sequelize, User } = require('./models');

async function ensureAdmin() {
  const usuario = process.env.PRIMEIRO_USO_ADMIN_USUARIO || 'admin';
  const senha = process.env.PRIMEIRO_USO_ADMIN_SENHA || 'admin123';

  const existing = await User.findOne({ where: { usuario } });
  if (!existing) {
    await User.create({
      nomeCompleto: 'Administrador do Sistema',
      usuario,
      senha,
    });
    console.log(`Usuário administrador criado: ${usuario}`);
  }
}

async function start() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    await ensureAdmin();

    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => {
      console.log(`Servidor da confeitaria rodando em http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Falha ao iniciar o servidor de confeitaria:', error);
    process.exit(1);
  }
}

start();
