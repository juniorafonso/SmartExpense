const express = require('express');

module.exports = (authMiddleware) => {
  const router = express.Router();
  const { requireLogin } = authMiddleware;

  /**
   * Rota GET /
   * Página inicial da aplicação após o login.
   */
  router.get('/', requireLogin, (req, res) => {
    // user já está em res.locals.currentUser
    res.render('index');
  });

  return router;
};