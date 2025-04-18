const express = require('express');
const path = require('path'); // Required for path joining
const fs = require('fs'); // Required for file system operations (deleting files)

module.exports = (db, upload, authMiddleware) => {
  const router = express.Router();
  const { requireLogin /*, requireAdmin */ } = authMiddleware;

  // GET /templates (List templates and count their associated expenses)
  router.get('/', requireLogin, (req, res) => {
    const lang = res.locals.lang; // Get language object

    // Fetch all templates ordered by name
    db.all('SELECT * FROM templates ORDER BY name ASC', (err, templates) => { // Use 'name' column
      if (err) {
          console.error('[GET /templates] Error fetching templates:', err.message);
          req.flash('error', lang.error_fetching_templates || 'Error fetching templates.');
          return res.render('templates', { templates: [] }); // Render with empty array on error
      }

      // If no templates found, render immediately
      if (!templates || templates.length === 0) {
        return res.render('templates', { templates: [] });
      }

      // Create promises to count expenses for each template
      const promises = templates.map(template => {
          return new Promise((resolve, reject) => {
              // Count expenses in 'template_expenses' table
              db.get('SELECT COUNT(*) AS total FROM template_expenses WHERE template_id = ?', [template.id], (errCount, row) => {
                  if (errCount) {
                      console.error(`[GET /templates] Error counting expenses for template ${template.id}:`, errCount.message);
                      template.expenseCount = 0; // Default to 0 on error
                  } else {
                      template.expenseCount = row.total || 0; // Assign count
                  }
                  resolve(template); // Resolve with the template object (now including expenseCount)
              });
          });
      });

      // Execute all count promises
      Promise.all(promises)
          .then(templatesWithCount => {
              // Render the 'templates.ejs' view with the templates array including counts
              res.render('templates', { templates: templatesWithCount });
          })
          .catch(error => {
              // Handle errors during the counting process
              console.error('[GET /templates] Error processing expense counts:', error);
              req.flash('error', lang.error_loading_templates || 'Error loading template data.');
              res.render('templates', { templates: [] }); // Render with empty array on error
          });
    });
  });

  // GET /templates/create (Display form to create a new template)
  router.get('/create', requireLogin, (req, res) => {
    res.render('create-template'); // Render 'create-template.ejs' view
  });

  // POST /templates (Create a new template - only the name)
  router.post('/', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const { name } = req.body; // Use 'name' from form body
    const templateName = name ? name.trim() : null;

    // Validate template name
    if (!templateName) {
      req.flash('error', lang.template_name_required || 'Template name is required.');
      return res.redirect('/templates/create'); // Redirect back to create form
    }

    // Check if template name already exists
    db.get('SELECT id FROM templates WHERE name = ?', [templateName], (errCheck, existingTemplate) => {
        if (errCheck) {
            console.error('[POST /templates] Error checking template name:', errCheck.message);
            req.flash('error', lang.error_generic || 'An error occurred while checking the template name.');
            return res.redirect('/templates/create');
        }
        if (existingTemplate) {
            req.flash('error', lang.error_template_name_exists || 'A template with this name already exists.');
            return res.redirect('/templates/create');
        }

        // Insert the new template into the database
        db.run('INSERT INTO templates (name) VALUES (?)', [templateName], function(errInsert) { // Use 'name' column
          if (errInsert) {
            console.error('[POST /templates] Error creating template:', errInsert.message);
            req.flash('error', lang.error_creating_template || 'Error creating template.');
            return res.redirect('/templates/create'); // Redirect back to create form on error
          }
          const newTemplateId = this.lastID; // Get the ID of the newly inserted template
          console.log(`[POST /templates] Template '${templateName}' (ID: ${newTemplateId}) created.`);
          req.flash('success', lang.template_created || 'Template created successfully.');
          // Redirect to the newly created template's detail page
          res.redirect(`/templates/${newTemplateId}`);
        });
    });
  });

  // GET /templates/:id (Display details/edit page for a specific template and its expenses)
  router.get('/:id', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const templateId = req.params.id;

    // Fetch template details, its expenses (with creditor names), and all creditors in parallel
    Promise.all([
        // Fetch the template itself
        new Promise((resolve, reject) => {
            db.get('SELECT * FROM templates WHERE id = ?', [templateId], (err, template) => {
                if (err) return reject(new Error(`Error fetching template: ${err.message}`));
                if (!template) return reject(new Error('Template not found.')); // Specific error for not found
                resolve(template);
            });
        }),
        // Fetch the template's expenses, joining with creditors table
        new Promise((resolve, reject) => {
            db.all(`
                SELECT te.*, c.name as creditor_name
                FROM template_expenses te
                LEFT JOIN creditors c ON te.creditor_id = c.id
                WHERE te.template_id = ? ORDER BY te.name ASC
            `, [templateId], (err, expenses) => { // Use 'template_expenses' and 'creditors' tables
                if (err) return reject(new Error(`Error fetching template expenses: ${err.message}`));
                resolve(expenses || []); // Return empty array if no expenses
            });
        }),
        // Fetch all creditors for dropdowns
        new Promise((resolve, reject) => {
            db.all('SELECT id, name FROM creditors ORDER BY name ASC', (err, creditors) => { // Use 'creditors' table
                if (err) return reject(new Error(`Error fetching creditors: ${err.message}`));
                resolve(creditors || []); // Return empty array if no creditors
            });
        })
    ])
    .then(([template, expenses, creditors]) => {
        // Render the 'template.ejs' view with fetched data
        res.render('template', {
            template,
            expenses,
            creditors
            // lang is already in res.locals
            // config is already in res.locals
        });
    })
    .catch(error => {
        // Handle errors from any of the promises
        console.error(`[GET /templates/${templateId}] Error loading data:`, error.message);
        if (error.message === 'Template not found.') {
            req.flash('error', lang.error_template_not_found || 'Template not found.');
            return res.redirect('/templates'); // Redirect to list if template not found
        }
        req.flash('error', lang.error_loading_template_details || 'Error loading template details.');
        res.redirect('/templates'); // Redirect to list on other errors
    });
  });

  // POST /templates/:id/edit (Update the template's name)
  router.post('/:id/edit', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const templateId = req.params.id;
    const { name } = req.body; // Use 'name' from form body
    const templateName = name ? name.trim() : null;

    // Validate new name
    if (!templateName) {
      req.flash('error', lang.template_name_required || 'Template name cannot be empty.');
      return res.redirect(`/templates/${templateId}`);
    }

    // Check if the new name conflicts with another existing template
    db.get('SELECT id FROM templates WHERE name = ? AND id != ?', [templateName, templateId], (errCheck, existingTemplate) => {
        if (errCheck) {
            console.error(`[POST /templates/${templateId}/edit] Error checking template name conflict:`, errCheck.message);
            req.flash('error', lang.error_generic || 'An error occurred while checking the template name.');
            return res.redirect(`/templates/${templateId}`);
        }
        if (existingTemplate) {
            req.flash('error', lang.error_template_name_exists || 'Another template with this name already exists.');
            return res.redirect(`/templates/${templateId}`);
        }

        // Update the template name in the database
        db.run('UPDATE templates SET name = ? WHERE id = ?', [templateName, templateId], function(errUpdate) { // Use 'name' column
          if (errUpdate) {
            console.error(`[POST /templates/${templateId}/edit] Error updating template name:`, errUpdate.message);
            req.flash('error', lang.error_updating_template || 'Error updating template name.');
          } else if (this.changes > 0) {
            console.log(`[POST /templates/${templateId}/edit] Template name updated to '${templateName}'.`);
            req.flash('success', lang.template_name_updated || 'Template name updated successfully.');
          } else {
            // This case means the template ID didn't exist
            console.warn(`[POST /templates/${templateId}/edit] No rows affected. Template ID ${templateId} might not exist.`);
            req.flash('error', lang.error_template_not_found || 'Template not found.');
            return res.redirect('/templates'); // Redirect to list if not found
          }
          // Redirect back to the template detail page (with potentially updated name in URL if needed, but ID is safer)
          res.redirect(`/templates/${templateId}`);
        });
    });
  });

  // POST /templates/:id/delete (Delete a template and its associated expenses) - CAUTION: Destructive action
  router.post('/:id/delete', requireLogin, /* requireAdmin, */ (req, res) => {
    const lang = res.locals.lang;
    const templateId = req.params.id;
    console.warn(`[POST /templates/${templateId}/delete] Attempting to delete template and its expenses.`);

    // Fetch associated expense files BEFORE deleting DB records
    db.all('SELECT file FROM template_expenses WHERE template_id = ?', [templateId], (errFiles, expenses) => {
        if (errFiles) {
            console.error(`[POST /templates/${templateId}/delete] Error finding template expenses for file deletion:`, errFiles.message);
            req.flash('error', lang.error_deleting_template_files || 'Error preparing to delete template files.');
            return res.redirect('/templates');
        }

        // Use a transaction to ensure atomicity
        db.serialize(() => {
          db.run("BEGIN TRANSACTION;");

          // Delete expenses associated with the template
          db.run('DELETE FROM template_expenses WHERE template_id = ?', [templateId], function(errDelExp) {
            if (errDelExp) {
              console.error(`[POST /templates/${templateId}/delete] Error deleting template expenses:`, errDelExp.message);
              db.run("ROLLBACK;"); // Rollback on error
              req.flash('error', lang.error_deleting_template_expenses || 'Error deleting template expenses.');
              return res.redirect('/templates');
            }
            console.log(`[POST /templates/${templateId}/delete] Template expenses deleted: ${this.changes}`);

            // Delete the template itself
            db.run('DELETE FROM templates WHERE id = ?', [templateId], function(errDelTpl) {
              if (errDelTpl) {
                console.error(`[POST /templates/${templateId}/delete] Error deleting template:`, errDelTpl.message);
                db.run("ROLLBACK;"); // Rollback on error
                req.flash('error', lang.error_deleting_template || 'Error deleting template.');
                return res.redirect('/templates');
              }

              // Check if the template was actually deleted
              if (this.changes === 0) {
                console.warn(`[POST /templates/${templateId}/delete] Template not found for deletion (or already deleted).`);
                // Still commit, as expenses might have been deleted if they existed.
                db.run("COMMIT;");
                req.flash('warning', lang.warning_template_not_found_delete || 'Template not found.');
                return res.redirect('/templates');
              }

              // Commit the transaction if all deletions were successful
              console.log(`[POST /templates/${templateId}/delete] Template deleted successfully from DB.`);
              db.run("COMMIT;", (errCommit) => {
                  if (errCommit) {
                      console.error(`[POST /templates/${templateId}/delete] Error committing delete transaction:`, errCommit.message);
                      req.flash('error', lang.error_deleting_template || 'Error finalizing template deletion.');
                      return res.redirect('/templates');
                  }

                  req.flash('success', lang.template_deleted || 'Template deleted successfully.');

                  // Delete associated files AFTER successful DB commit
                  if (expenses && expenses.length > 0) {
                      let fileDeleteErrors = 0;
                      expenses.forEach(expense => {
                          if (expense.file) {
                              const filePath = path.join(__dirname, '..', 'uploads', expense.file);
                              fs.unlink(filePath, (errUnlink) => {
                                  if (errUnlink && errUnlink.code !== 'ENOENT') { // Ignore 'file not found'
                                      console.error(`[POST /templates/${templateId}/delete] Error deleting file ${expense.file}:`, errUnlink.message);
                                      fileDeleteErrors++;
                                  } else if (!errUnlink) {
                                      console.log(`[POST /templates/${templateId}/delete] Deleted file ${expense.file}.`);
                                  }
                              });
                          }
                      });
                      if (fileDeleteErrors > 0) {
                          req.flash('warning', lang.warning_template_deleted_file_errors || 'Template deleted, but errors occurred while removing associated files.');
                      }
                  }
                  res.redirect('/templates'); // Redirect to templates list
              });
            });
          });
        });
    });
  });

  // --- Template Expense Routes (template_expenses) ---

  // POST /templates/:id/expenses (Add an expense to a template)
  router.post('/:id/expenses', requireLogin, upload.single('file'), (req, res) => { // Use 'file' as field name
    const lang = res.locals.lang;
    const templateId = req.params.id;
    // Use English field names from form body
    const { name, amount, day_of_month, type, iban, notes, creditor_id } = req.body;
    const file = req.file ? req.file.filename : null; // Get filename from multer if uploaded

    // Basic validation
    if (!name || !amount || !day_of_month || !type) {
      console.error(`[POST /templates/${templateId}/expenses] Validation failed: Required fields missing.`);
      req.flash('error', lang.error_template_expense_required || 'Name, Amount, Day of Month, and Type are required.');
       // Clean up uploaded file if validation fails
      if (req.file) {
          const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
          fs.unlink(tempPath, (err) => { if (err) console.error("Error deleting uploaded file on validation fail:", err.message); });
      }
      return res.redirect(`/templates/${templateId}`);
    }
     if (!['fixed', 'one-time'].includes(type)) {
        req.flash('error', lang.error_invalid_expense_type || 'Invalid expense type.');
        if (req.file) { // Clean up file
            const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
            fs.unlink(tempPath, (err) => { if (err) console.error("Error deleting uploaded file on validation fail:", err.message); });
        }
        return res.redirect(`/templates/${templateId}`);
    }
     const day = parseInt(day_of_month, 10);
     if (isNaN(day) || day < 1 || day > 31) {
        req.flash('error', lang.error_invalid_day_of_month || 'Invalid day of month.');
         if (req.file) { // Clean up file
             const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
             fs.unlink(tempPath, (err) => { if (err) console.error("Error deleting uploaded file on validation fail:", err.message); });
         }
        return res.redirect(`/templates/${templateId}`);
     }


    // Insert the new template expense into the database
    db.run(
      // Use English column names
      `INSERT INTO template_expenses (template_id, name, amount, day_of_month, type, iban, notes, file, creditor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
          templateId,
          name,
          amount,
          day, // Use parsed day
          type, // 'fixed' or 'one-time'
          iban || null,
          notes || null,
          file, // Uploaded filename or null
          creditor_id || null
      ],
      function(errInsert) {
        if (errInsert) {
          console.error(`[POST /templates/${templateId}/expenses] Error adding expense to template:`, errInsert.message);
          req.flash('error', lang.error_adding_template_expense || 'Error adding expense to template.');
           // Clean up uploaded file if DB insert fails
          if (req.file) {
              const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
              fs.unlink(tempPath, (errUnlink) => { if (errUnlink) console.error("Error deleting uploaded file on DB fail:", errUnlink.message); });
          }
        } else {
          console.log(`[POST /templates/${templateId}/expenses] Expense '${name}' (ID: ${this.lastID}) added to template.`);
          req.flash('success', lang.template_expense_added || 'Expense added to template successfully.');
        }
        res.redirect(`/templates/${templateId}`); // Redirect back to the template detail page
      }
    );
  });

  // GET /templates/:templateId/expenses/:id/edit (Display edit form for a template expense)
  // This route might not be strictly necessary if using modals, but good for completeness or direct linking.
  router.get('/:templateId/expenses/:id/edit', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const { templateId, id: expenseId } = req.params;

    Promise.all([
        // Fetch the specific template expense
        new Promise((resolve, reject) => {
            db.get('SELECT * FROM template_expenses WHERE id = ? AND template_id = ?', [expenseId, templateId], (err, expense) => {
                if (err) return reject(new Error(`Error fetching template expense: ${err.message}`));
                if (!expense) return reject(new Error('Template expense not found.'));
                resolve(expense);
            });
        }),
        // Fetch all creditors for the dropdown
        new Promise((resolve, reject) => {
            db.all('SELECT id, name FROM creditors ORDER BY name ASC', (err, creditors) => {
                if (err) return reject(new Error(`Error fetching creditors: ${err.message}`));
                resolve(creditors || []);
            });
        }),
         // Fetch template name for context
        new Promise((resolve, reject) => {
            db.get('SELECT name FROM templates WHERE id = ?', [templateId], (err, template) => {
                if (err) return reject(new Error(`Error fetching template name: ${err.message}`));
                if (!template) return reject(new Error('Parent template not found.'));
                resolve(template);
            });
        })
    ])
    .then(([expense, creditors, template]) => {
        // Render a dedicated edit view (e.g., 'edit-template-expense.ejs')
        // You might need to create this view if you want a separate page.
        // For now, let's assume it redirects back if accessed directly, as the modal handles it.
        // res.render('edit-template-expense', { expense, creditors, templateId, templateName: template.name });
        console.warn(`[GET /templates/.../${expenseId}/edit] Direct access to edit route - typically handled by modal. Redirecting.`);
        req.flash('info', lang.edit_via_modal || 'Please edit expenses using the modal on the template page.');
        res.redirect(`/templates/${templateId}`);
    })
    .catch(error => {
        console.error(`[GET /templates/.../${expenseId}/edit] Error:`, error.message);
        if (error.message === 'Template expense not found.' || error.message === 'Parent template not found.') {
            req.flash('error', lang.error_template_or_expense_not_found || 'Template or expense not found.');
        } else {
            req.flash('error', lang.error_loading_edit_data || 'Error loading data for editing.');
        }
        res.redirect(`/templates/${templateId}`); // Redirect back to template page on error
    });
  });

  // POST /templates/:templateId/expenses/:id/edit (Update a template expense)
  router.post('/:templateId/expenses/:id/edit', requireLogin, upload.single('file'), (req, res) => { // Use 'file' as field name
    const lang = res.locals.lang;
    const { templateId, id: expenseId } = req.params;
    // Use English field names from form body
    const { name, amount, day_of_month, type, iban, notes, creditor_id, delete_file } = req.body;
    const newFile = req.file ? req.file.filename : null; // Get new filename if uploaded

     // Basic validation (similar to add)
    if (!name || !amount || !day_of_month || !type) {
      req.flash('error', lang.error_template_expense_required || 'Name, Amount, Day of Month, and Type are required.');
       if (req.file) { // Clean up newly uploaded file
           const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
           fs.unlink(tempPath, (err) => { if (err) console.error("Error deleting new file on validation fail:", err.message); });
       }
      return res.redirect(`/templates/${templateId}`);
    }
     if (!['fixed', 'one-time'].includes(type)) {
        req.flash('error', lang.error_invalid_expense_type || 'Invalid expense type.');
        if (req.file) { // Clean up file
            const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
            fs.unlink(tempPath, (err) => { if (err) console.error("Error deleting new file on validation fail:", err.message); });
        }
        return res.redirect(`/templates/${templateId}`);
    }
     const day = parseInt(day_of_month, 10);
     if (isNaN(day) || day < 1 || day > 31) {
        req.flash('error', lang.error_invalid_day_of_month || 'Invalid day of month.');
         if (req.file) { // Clean up file
             const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
             fs.unlink(tempPath, (err) => { if (err) console.error("Error deleting new file on validation fail:", err.message); });
         }
        return res.redirect(`/templates/${templateId}`);
     }

    // Fetch the current expense to get the old filename
    db.get('SELECT file FROM template_expenses WHERE id = ? AND template_id = ?', [expenseId, templateId], (errFetch, currentExpense) => {
      if (errFetch) {
        console.error(`[POST /templates/.../${expenseId}/edit] Error fetching old file:`, errFetch.message);
        req.flash('error', lang.error_updating_template_expense || 'Error updating template expense.');
         if (req.file) { // Clean up newly uploaded file
             const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
             fs.unlink(tempPath, (err) => { if (err) console.error("Error deleting new file on fetch fail:", err.message); });
         }
        return res.redirect(`/templates/${templateId}`);
      }
       // Check if the expense was found
       if (!currentExpense) {
          console.error(`[POST /templates/.../${expenseId}/edit] Template expense not found for editing.`);
          req.flash('error', lang.error_template_expense_not_found || 'Template expense not found.');
           if (req.file) { // Clean up newly uploaded file
               const tempPath = path.join(__dirname, '..', 'uploads', req.file.filename);
               fs.unlink(tempPath, (err) => { if (err) console.error("Error deleting new file on not found:", err.message); });
           }
          return res.redirect(`/templates/${templateId}`);
      }

      const oldFile = currentExpense.file;
      let finalFile = oldFile; // Assume keeping the old file
      let fileToDeletePhysically = null; // Track which physical file to delete

      // Helper function to delete a physical file
      const deletePhysicalFile = (filename) => {
          if (!filename) return;
          const filePath = path.join(__dirname, '..', 'uploads', filename);
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr && unlinkErr.code !== 'ENOENT') { // Ignore 'file not found'
                console.error(`Error deleting physical file ${filename}:`, unlinkErr.message);
            } else if (!unlinkErr) {
                console.log(`Physical file ${filename} deleted.`);
            }
          });
      };

      if (newFile) {
          // If a new file is uploaded, it replaces the old one
          finalFile = newFile;
          if (oldFile && oldFile !== newFile) {
              fileToDeletePhysically = oldFile; // Mark the old physical file for deletion
          }
          console.log(`[POST /templates/.../${expenseId}/edit] New file '${newFile}' uploaded. Old file '${oldFile}' marked for deletion.`);
      } else if (delete_file === 'true') {
          // If no new file, but deletion is requested
          finalFile = null; // Remove file reference from DB
          if (oldFile) {
              fileToDeletePhysically = oldFile; // Mark the old physical file for deletion
          }
          console.log(`[POST /templates/.../${expenseId}/edit] Request to delete existing file '${oldFile}'.`);
      }
      // If no new file and delete_file is not 'true', finalFile remains oldFile, and no physical deletion needed now.

      // Update the template expense in the database
      db.run(
        // Use English column names
        `UPDATE template_expenses
         SET name = ?, amount = ?, day_of_month = ?, type = ?, iban = ?, notes = ?, creditor_id = ?, file = ?
         WHERE id = ? AND template_id = ?`,
        [
            name, amount, day, type, iban || null, notes || null,
            creditor_id || null,
            finalFile, // Use the determined final filename (new, null, or old)
            expenseId,
            templateId
        ],
        function(errUpdate) {
          if (errUpdate) {
            console.error(`[POST /templates/.../${expenseId}/edit] Error updating expense in DB:`, errUpdate.message);
            req.flash('error', lang.error_updating_template_expense || 'Error updating template expense.');
            // IMPORTANT: If DB update fails, DO NOT delete the old physical file.
            // However, if a NEW file was uploaded, we should delete IT as it's now orphaned.
            if (newFile) {
                deletePhysicalFile(newFile);
                console.log(`[POST /templates/.../${expenseId}/edit] Deleted newly uploaded file '${newFile}' due to DB update error.`);
            }
          } else if (this.changes > 0) {
            console.log(`[POST /templates/.../${expenseId}/edit] Template expense updated successfully. Final file: ${finalFile}`);
            req.flash('success', lang.template_expense_updated || 'Template expense updated successfully.');
            // Delete the old physical file AFTER successful DB update
            if (fileToDeletePhysically) {
                deletePhysicalFile(fileToDeletePhysically);
            }
          } else {
            // This means the expense ID or template ID didn't match, or data was identical
            console.warn(`[POST /templates/.../${expenseId}/edit] No rows updated. Expense might not exist or data unchanged.`);
            req.flash('warning', lang.warning_template_expense_not_found_or_no_change || 'Expense not found or no changes made.');
             // If a new file was uploaded but no DB rows changed, delete the new file.
            if (newFile) {
                deletePhysicalFile(newFile);
                console.log(`[POST /templates/.../${expenseId}/edit] Deleted newly uploaded file '${newFile}' as no DB changes occurred.`);
            }
          }
          res.redirect(`/templates/${templateId}`); // Redirect back to the template detail page
        }
      );
    });
  });

  // POST /templates/:templateId/expenses/:id/delete (Delete an expense from a template) - CAUTION: Destructive action
  router.post('/:templateId/expenses/:id/delete', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const { templateId, id: expenseId } = req.params;
    console.warn(`[POST /templates/.../${expenseId}/delete] Attempting to delete template expense.`);

    // First, get the filename if it exists, verifying template_id
    db.get('SELECT file FROM template_expenses WHERE id = ? AND template_id = ?', [expenseId, templateId], (errFetch, templateExpense) => {
        if (errFetch) {
            console.error(`[POST /templates/${templateId}/expenses/${expenseId}/delete] Error fetching template expense:`, errFetch.message);
            req.flash('error', lang.error_fetching_template_expense || 'Error fetching template expense details.');
            return res.redirect(`/templates/${templateId}`);
        }

        const fileToDelete = templateExpense ? templateExpense.file : null;

        // Delete the template expense record, verifying template_id
        db.run('DELETE FROM template_expenses WHERE id = ? AND template_id = ?', [expenseId, templateId], function(errDelete) {
            if (errDelete) {
                console.error(`[POST /templates/${templateId}/expenses/${expenseId}/delete] Error deleting template expense record:`, errDelete.message);
                req.flash('error', lang.error_deleting_template_expense || 'Error deleting template expense.');
            } else if (this.changes === 0) {
                console.warn(`[POST /templates/${templateId}/expenses/${expenseId}/delete] Template expense ID ${expenseId} not found for template ID ${templateId}.`);
                req.flash('warning', lang.warning_template_expense_not_found || 'Template expense not found.');
            } else {
                // --- Deletion successful, now check file usage ---
                console.log(`[POST /templates/${templateId}/expenses/${expenseId}/delete] Template expense record deleted from DB successfully.`);
                req.flash('success', lang.success_template_expense_deleted || 'Template expense deleted successfully.');

                // If delete was successful and a file existed, check if it's used by projects BEFORE deleting
                if (fileToDelete) {
                    // Check if the file is used in the main expenses table
                    db.get('SELECT 1 FROM expenses WHERE file = ? LIMIT 1', [fileToDelete], (errCheckProj, projectUsage) => {
                        if (errCheckProj) {
                            console.error(`[POST /templates/${templateId}/expenses/${expenseId}/delete] Error checking project usage for file ${fileToDelete}:`, errCheckProj.message);
                            req.flash('warning', lang.warning_file_check_failed_project || 'Could not verify project usage for the file.');
                            // Keep file safe on error
                            console.warn(`[POST /templates/${templateId}/expenses/${expenseId}/delete] Keeping file ${fileToDelete} due to check error.`);

                        } else if (projectUsage) {
                            // File IS used by a project, DO NOT DELETE IT
                            console.log(`[POST /templates/${templateId}/expenses/${expenseId}/delete] File ${fileToDelete} is used by a project. Physical file NOT deleted.`);

                        } else {
                            // File is NOT used by any project, safe to delete
                            console.log(`[POST /templates/${templateId}/expenses/${expenseId}/delete] File ${fileToDelete} is not used by projects. Deleting physical file.`);
                            const filePath = path.join(__dirname, '..', 'uploads', fileToDelete);
                            fs.unlink(filePath, (errUnlink) => {
                                if (errUnlink && errUnlink.code !== 'ENOENT') { // Ignore 'file not found'
                                    console.error(`[POST /templates/${templateId}/expenses/${expenseId}/delete] Error deleting physical file ${fileToDelete}:`, errUnlink.message);
                                    req.flash('warning', lang.warning_file_delete_failed || 'Template expense record deleted, but failed to delete associated file.');
                                } else if (!errUnlink) {
                                    console.log(`[POST /templates/${templateId}/expenses/${expenseId}/delete] Deleted physical file ${fileToDelete}.`);
                                }
                            });
                        }
                        // Redirect happens after the check (or potential unlink)
                        res.redirect(`/templates/${templateId}`);
                    });
                    return; // IMPORTANT: Prevent the redirect below from running immediately
                }
                // --- End file usage check ---
            }
            // Redirect immediately if no file to check or if DB delete failed/did nothing
            res.redirect(`/templates/${templateId}`);
        });
    });
  });

  return router;
};