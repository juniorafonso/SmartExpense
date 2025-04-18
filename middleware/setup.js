/**
 * Middleware: Verifica se o setup inicial é necessário.
 */
function checkSetup(getNeedsSetup) { // Recebe uma função para obter o estado atual de needsSetup
  return (req, res, next) => {
    const needsSetup = getNeedsSetup(); // Obtém o estado atual
    const allowedSetupPaths = [
      '/setup',
      '/login',
      '/css/bootstrap.min.css', // Permite acesso ao CSS do Bootstrap
      '/js/bootstrap.bundle.min.js' // Permite acesso ao JS do Bootstrap
      // Adicione outros arquivos estáticos específicos do setup/login se necessário
    ];

    if (needsSetup) {
      // Se precisa de setup, só permite acesso às rotas de setup/login e estáticos essenciais
      if (!allowedSetupPaths.includes(req.path) && !req.path.startsWith('/public') && !req.path.startsWith('/css') && !req.path.startsWith('/js')) {
        console.log(`[Setup Check] Needs setup: Redirecting from ${req.path} to /setup`);
        return res.redirect('/setup');
      }
    } else {
      // Se NÃO precisa de setup, bloqueia o acesso direto à rota /setup
      if (req.path === '/setup') {
        console.log(`[Setup Check] Setup done: Redirecting from /setup to /login`);
        return res.redirect('/login');
      }
    }
    next();
  };
}

module.exports = {
  checkSetup
};