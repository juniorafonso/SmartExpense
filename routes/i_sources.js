const express = require('express');
const router = express.Router();

// Recebe db e funções de middleware de autenticação
module.exports = (db, authMiddleware) => {

    // GET /income-sources - Lista todas as fontes de renda
    router.get('/', authMiddleware.requireLogin, (req, res) => {
        const lang = res.locals.lang;
        db.all('SELECT * FROM income_sources ORDER BY name ASC', [], (err, sources) => {
            if (err) {
                console.error("[GET /income-sources] Error fetching sources:", err.message);
                req.flash('error', lang.error_fetching_data || 'Error fetching data.');
                sources = []; // Envia array vazio em caso de erro
            }
            res.render('income_sources', {
                title: lang.income_sources || 'Income Sources',
                sources: sources, // Passa as fontes para a view
                user: req.session.user,
                lang: lang,
                layout: 'layout' // Define o layout principal
                // Removido 'contentFor' pois não usamos mais essa estrutura aqui
            });
        });
    });

    // POST /income-sources - Adiciona uma nova fonte de renda (Rota para o modal 'Add')
    router.post('/', authMiddleware.requireLogin, (req, res) => {
        const lang = res.locals.lang;
        const { name, type } = req.body;

        if (!name) {
            req.flash('error', lang.error_name_required || 'Name is required.');
            return res.redirect('/income-sources');
        }

        const sql = 'INSERT INTO income_sources (name, type) VALUES (?, ?)';
        db.run(sql, [name, type || null], function(err) { // Usa null se type for vazio
            if (err) {
                console.error("[POST /income-sources] Error adding source:", err.message);
                if (err.message.includes('UNIQUE constraint failed')) {
                    req.flash('error', lang.error_source_name_exists || 'An income source with this name already exists.');
                } else {
                    req.flash('error', lang.error_adding_data || 'Error adding data.');
                }
            } else {
                console.log(`[POST /income-sources] Source added successfully (ID: ${this.lastID})`);
                req.flash('success', lang.success_source_added || 'Income source added successfully.');
            }
            res.redirect('/income-sources');
        });
    });

    // POST /income-sources/:id/edit - Edita uma fonte de renda existente (Rota para o modal 'Edit')
    router.post('/:id/edit', authMiddleware.requireLogin, (req, res) => { // Rota ajustada
        const lang = res.locals.lang;
        const { id } = req.params;
        const { name, type } = req.body;

        if (!name) {
            req.flash('error', lang.error_name_required || 'Name is required.');
            return res.redirect('/income-sources');
        }

        const sql = 'UPDATE income_sources SET name = ?, type = ? WHERE id = ?';
        db.run(sql, [name, type || null, id], function(err) {
            if (err) {
                console.error(`[POST /income-sources/${id}/edit] Error updating source:`, err.message);
                 if (err.message.includes('UNIQUE constraint failed')) {
                    req.flash('error', lang.error_source_name_exists || 'An income source with this name already exists.');
                } else {
                    req.flash('error', lang.error_updating_data || 'Error updating data.');
                }
            } else if (this.changes === 0) {
                console.warn(`[POST /income-sources/${id}/edit] Source ID not found.`);
                req.flash('error', lang.error_source_not_found || 'Income source not found.');
            } else {
                console.log(`[POST /income-sources/${id}/edit] Source updated successfully.`);
                req.flash('success', lang.success_source_updated || 'Income source updated successfully.');
            }
            res.redirect('/income-sources');
        });
    });

    // POST /income-sources/:id/delete - Deleta uma fonte de renda (Rota para o form 'Delete')
    router.post('/:id/delete', authMiddleware.requireLogin, (req, res) => { // Rota ajustada
        const lang = res.locals.lang;
        const { id } = req.params;

        // Opcional: Verificar se a fonte está sendo usada em 'incomes' antes de deletar
        db.get('SELECT COUNT(*) as count FROM incomes WHERE income_source_id = ?', [id], (errCheck, row) => {
            if (errCheck) {
                console.error(`[POST /income-sources/${id}/delete] Error checking usage:`, errCheck.message);
                req.flash('error', lang.error_checking_usage || 'Error checking source usage.');
                return res.redirect('/income-sources');
            }

            if (row && row.count > 0) {
                console.warn(`[POST /income-sources/${id}/delete] Attempted to delete source used by ${row.count} income(s).`);
                req.flash('error', lang.error_source_in_use || 'Cannot delete this source because it is associated with existing income records.');
                return res.redirect('/income-sources');
            }

            // Se não estiver em uso, prosseguir com a deleção
            const sql = 'DELETE FROM income_sources WHERE id = ?';
            db.run(sql, [id], function(err) {
                if (err) {
                    console.error(`[POST /income-sources/${id}/delete] Error deleting source:`, err.message);
                    req.flash('error', lang.error_deleting_data || 'Error deleting data.');
                } else if (this.changes === 0) {
                    console.warn(`[POST /income-sources/${id}/delete] Source ID not found.`);
                    req.flash('error', lang.error_source_not_found || 'Income source not found.');
                } else {
                    console.log(`[POST /income-sources/${id}/delete] Source deleted successfully.`);
                    req.flash('success', lang.success_source_deleted || 'Income source deleted successfully.');
                }
                res.redirect('/income-sources');
            });
        });
    });

    return router;
};
