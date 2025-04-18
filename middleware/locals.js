/**
 * Middleware: Define variáveis locais (res.locals) para uso nas views.
 */
function setLocals(config, langData, DEV_MODE, getDefaultLocale) { // Recebe dependências
  return (req, res, next) => {
    const defaultLocale = getDefaultLocale(); // Obtém o locale padrão atual
    const langCode = req.session?.lang || defaultLocale;
    const idiomaValido = ['pt', 'en', 'fr'].includes(langCode) ? langCode : 'en';

    // Garante que a sessão tenha o idioma definido
    if (req.session && !req.session.lang) {
      req.session.lang = idiomaValido;
    }

    res.locals.lang = langData[idiomaValido] || langData['en']; // Passa traduções para views
    res.locals.config = config; // Passa config para views
    res.locals.currentUser = req.session.user; // Passa usuário logado para views (pode ser undefined)
    res.locals.DEV_MODE = DEV_MODE; // Passa DEV_MODE para views
    res.locals.currentPath = req.path; // Passa o caminho atual para views (útil para active links)
    next();
  };
}

module.exports = {
  setLocals
};