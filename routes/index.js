const express = require('express');
const router = express.Router();

// ACEITE 'db' como o primeiro parâmetro
module.exports = (db, authMiddleware) => {
    const { ensureAuthenticated } = authMiddleware;

    // Helper para transformar db.get/db.all em Promise
    const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
    const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });

    router.get('/', ensureAuthenticated, async (req, res) => {
        let activeProjects = [];
        let creditors = [];
        let stats = {};
        let annualPlanItems = [];

        try {
            activeProjects = await dbAll(
                'SELECT name FROM projects WHERE status = ? ORDER BY name ASC',
                ['active']
            );

            creditors = await dbAll(
                'SELECT id, name FROM creditors ORDER BY name ASC'
            );

            const totalProjectsRow = await dbGet('SELECT COUNT(*) as count FROM projects');
            const finishedProjectsRow = await dbGet('SELECT COUNT(*) as count FROM projects WHERE status = ?', ['finished']);
            const paymentMethodsRow = await dbGet('SELECT COUNT(*) as count FROM payments');

            stats = {
                totalProjects: totalProjectsRow?.count ?? 0,
                activeProjects: activeProjects.length,
                finishedProjects: finishedProjectsRow?.count ?? 0,
                paymentMethods: paymentMethodsRow?.count ?? 0
            };

            annualPlanItems = await dbAll('SELECT * FROM annual_plan_items ORDER BY order_index ASC');
        } catch (error) {
            console.error('[Index Route] Error during data fetching:', error); // Adicionado log de erro
            stats = { totalProjects: 'Err', activeProjects: 'Err', finishedProjects: 'Err', paymentMethods: 'Err' };
            activeProjects = [];
            creditors = [];
            annualPlanItems = [];
        }

        try {
            // <<< CORREÇÃO AQUI: Usar res.locals.config que é definido pelo middleware >>>
            const configData = res.locals.config || { DEFAULT_CURRENCY: 'CUR' }; // Fallback caso res.locals.config não exista

            const viewData = {
                title: res.locals.lang?.dashboard_title || 'Dashboard',
                lang: res.locals.lang,
                currentLang: res.locals.currentLang,
                availableLangs: res.locals.availableLangs,
                needsSetup: res.locals.needsSetup,
                currentUser: req.session.user,
                user: req.session.user,
                stats: stats,
                activeProjects: activeProjects,
                creditors: creditors,
                annualPlanItems: annualPlanItems,
                config: configData // Passando o config correto para a view
            };

            res.render('index', viewData);

        } catch (renderError) {
            console.error('[Index Route] Error preparing view data or rendering:', renderError); // Adicionado log de erro
            res.status(500).send(res.locals.lang?.error_generic || 'An unexpected error occurred while rendering the page.');
        }
    });

    return router;
};