const express = require('express');

module.exports = (db, authMiddleware) => {
  const router = express.Router();
  const { requireLogin /*, requireAdmin */ } = authMiddleware; // Assuming requireAdmin might be used later

  // GET /creditors (List creditors)
  router.get('/', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    // Use correct table name 'creditors' and column 'name'
    db.all('SELECT * FROM creditors ORDER BY name ASC', (err, creditors) => {
      if (err) {
        console.error('[GET /creditors] Error fetching creditors:', err.message);
        // Add user feedback (e.g., using flash messages)
        req.flash('error', lang.error_fetching_creditors || 'Error fetching creditors.');
        return res.render('creditors', { 
          title: lang.creditors || 'Creditors',
          creditors: [] 
        }); // Render page even on error
      }
      // Assuming 'creditors.ejs' exists and expects 'creditors' array and flash messages
      res.render('creditors', { 
        title: lang.creditors || 'Creditors',
        creditors: creditors || [] 
      });
    });
  });

  // POST /creditors (Add new creditor)
  router.post('/', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    // Use correct field names 'name' and 'information' from req.body
    const { name, information } = req.body;
    const creditorName = name ? name.trim() : null;

    if (!creditorName) {
      req.flash('error', lang.error_creditor_name_required || 'Creditor name is required.');
      return res.redirect('/creditors');
    }

    // Use correct table name 'creditors' and column names 'name', 'information'
    db.run('INSERT INTO creditors (name, information) VALUES (?, ?)', [creditorName, information || null], function(err) {
      if (err) {
        console.error('[POST /creditors] Error adding creditor:', err.message);
        if (err.message.includes('UNIQUE constraint failed')) {
             // Assuming name should be unique, though not enforced by schema yet
             req.flash('error', lang.error_creditor_name_taken || `Creditor name '${creditorName}' is already taken.`);
        } else {
             req.flash('error', lang.error_adding_creditor || 'Error adding creditor.');
        }
      } else {
        console.log(`[POST /creditors] Creditor '${creditorName}' (ID: ${this.lastID}) added.`);
        req.flash('success', lang.success_creditor_added || `Creditor '${creditorName}' added successfully.`);
      }
      res.redirect('/creditors');
    });
  });

  // POST /creditors/:id/edit (Edit creditor)
  router.post('/:id/edit', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const creditorId = req.params.id;
    // Use correct field names 'name' and 'information' from req.body
    const { name, information } = req.body;
    const creditorName = name ? name.trim() : null;

    if (!creditorName) {
      req.flash('error', lang.error_creditor_name_required || 'Creditor name is required.');
      // Redirect back to the creditors list, or potentially to an edit page if you have one
      return res.redirect('/creditors');
    }

    // Use correct table name 'creditors' and column names 'name', 'information'
    db.run('UPDATE creditors SET name = ?, information = ? WHERE id = ?', [creditorName, information || null, creditorId], function(err) {
      if (err) {
        console.error(`[POST /creditors/${creditorId}/edit] Error editing creditor:`, err.message);
         if (err.message.includes('UNIQUE constraint failed')) {
             req.flash('error', lang.error_creditor_name_taken || `Creditor name '${creditorName}' is already taken.`);
        } else {
            req.flash('error', lang.error_editing_creditor || 'Error editing creditor.');
        }
      } else if (this.changes > 0) {
        console.log(`[POST /creditors/${creditorId}/edit] Creditor updated to '${creditorName}'.`);
        req.flash('success', lang.success_creditor_updated || `Creditor '${creditorName}' updated successfully.`);
      } else {
        console.warn(`[POST /creditors/${creditorId}/edit] No rows affected. Creditor ID ${creditorId} may not exist.`);
        req.flash('warning', lang.warning_creditor_not_found || 'Creditor not found or no changes made.');
      }
      res.redirect('/creditors');
    });
  });

  // POST /creditors/:id/delete (Delete creditor)
  router.post('/:id/delete', requireLogin, /* requireAdmin, */ (req, res) => {
    const lang = res.locals.lang;
    const creditorId = req.params.id;
    console.warn(`[POST /creditors/${creditorId}/delete] Attempting to delete creditor.`);
    // ON DELETE SET NULL in schema handles FK references in expenses/template_expenses

    // Use correct table name 'creditors'
    db.run('DELETE FROM creditors WHERE id = ?', [creditorId], function(err) {
      if (err) {
        console.error(`[POST /creditors/${creditorId}/delete] Error deleting creditor:`, err.message);
        req.flash('error', lang.error_deleting_creditor || 'Error deleting creditor.');
      } else if (this.changes > 0) {
        console.log(`[POST /creditors/${creditorId}/delete] Creditor deleted successfully.`);
        req.flash('success', lang.success_creditor_deleted || 'Creditor deleted successfully.');
      } else {
        console.warn(`[POST /creditors/${creditorId}/delete] No rows affected. Creditor ID ${creditorId} may not exist.`);
        req.flash('warning', lang.warning_creditor_not_found_delete || 'Creditor not found.');
      }
      res.redirect('/creditors');
    });
  });

  return router;
};