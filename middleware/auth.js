/**
 * Middleware: Garante que o usuário esteja logado.
 * Em DEV_MODE, simula um usuário admin se não houver sessão.
 */
function requireLogin(DEV_MODE) {
  return (req, res, next) => {
    if (DEV_MODE && !req.session.user) {
      req.session.user = { id: 0, username: 'dev_admin', role: 'admin' }; // Simula admin em DEV_MODE
      console.log("[Auth Check] DEV_MODE: Simulando login como dev_admin");
      // Garante que res.locals.currentUser seja definido mesmo na simulação
      res.locals.currentUser = req.session.user;
      return next();
    }

    if (!req.session.user) {
      console.log(`[Auth Check] Login required: Redirecting from ${req.path} to /login`);
      return res.redirect('/login');
    }
    // Garante que res.locals.currentUser esteja definido para usuários logados
    res.locals.currentUser = req.session.user;
    next();
  };
}

/**
 * Middleware: Garante que o usuário logado tenha a role 'admin'.
 */
function requireAdmin(DEV_MODE) {
  const checkLogin = requireLogin(DEV_MODE); // Obtém a função requireLogin configurada

  return (req, res, next) => {
    // Primeiro, verifica se está logado (ou simulado em DEV_MODE)
    checkLogin(req, res, () => {
      // Se passou pelo checkLogin, verifica a role
      // Certifica-se de que req.session.user existe (pode ter sido criado pelo checkLogin em DEV_MODE)
      if (!req.session.user || req.session.user.role !== 'admin') {
        const username = req.session.user?.username || 'unknown';
        const role = req.session.user?.role || 'none';
        console.warn(`[Admin Check] Forbidden: User '${username}' (role: ${role}) tried to access admin route ${req.path}`);
        // Pode redirecionar ou enviar erro 403
        // return res.redirect('/'); // Redireciona para a home
        return res.status(403).send(res.locals.lang?.error_admin_required || 'Access Denied. Administrator permission required.');
      }
      next(); // Permite acesso se for admin
    });
  };
}

module.exports = (DEV_MODE) => ({
  requireLogin: requireLogin(DEV_MODE),
  requireAdmin: requireAdmin(DEV_MODE)
});