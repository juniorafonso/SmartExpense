const express = require('express');
const path = require('path');
const fs = require('fs'); // Required for file system operations (deleting files)

//const { formatCurrency, formatDate } = require('../utils/formatters'); // Assuming formatters utility

// Helper function to get project ID by name
// Necessary because expenses table uses project_id, not project_name
function getProjectIdByName(db, projectName, callback) {
  db.get('SELECT id FROM projects WHERE name = ?', [projectName], (err, row) => {
    if (err) {
      console.error(`[Helper getProjectIdByName] Error fetching ID for project '${projectName}':`, err.message);
      return callback(err, null);
    }
    if (!row) {
      const notFoundError = new Error(`Project with name '${projectName}' not found.`);
      notFoundError.code = 'PROJECT_NOT_FOUND'; // Custom code for specific handling
      return callback(notFoundError, null);
    }
    callback(null, row.id); // Pass the found ID
  });
}

// Accept getConfig function instead of config object
module.exports = (db, upload, getConfig, authMiddleware) => { // <-- Changed config to getConfig
  const router = express.Router();
  const { requireLogin, requireAdmin } = authMiddleware; // Use passed authMiddleware

  // GET / (List projects) - Mounted as /projects/
  router.get('/', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const currentConfig = getConfig(); // <-- Get current config inside the handler

    // Optimized SQL query to get projects with aggregated expense data
    const sql = `
      SELECT
        p.id,
        p.name,
        p.status,
        COUNT(CASE WHEN e.type = 'fixed' THEN e.id END) AS fixedCount,
        COUNT(CASE WHEN e.type = 'one-time' THEN e.id END) AS oneTimeCount,
        SUM(e.amount) AS totalAmount
      FROM projects p
      LEFT JOIN expenses e ON p.id = e.project_id -- Join on project_id
      GROUP BY p.id, p.name, p.status
      ORDER BY p.name ASC;
    `;

    db.all(sql, [], (err, projects) => {
      if (err) {
        console.error('[GET /projects] Error fetching projects with aggregated data:', err.message);
        req.flash('error', lang.error_fetching_projects || 'Error fetching projects.');
        // Render with empty arrays and current config even on error
        return res.render('projects', { activeProjects: [], finishedProjects: [], config: currentConfig }); // Pass currentConfig
      }

      // Separate projects by status
      const activeProjects = projects.filter(p => p.status === 'active');
      const finishedProjects = projects.filter(p => p.status === 'finished');

      res.render('projects', {
        activeProjects,
        finishedProjects,
        config: currentConfig // Pass current config for currency formatting
        // lang is already in res.locals
      });
    });
  });

  // GET /create (Display creation form) - Mounted as /projects/create
  router.get('/create', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    // Fetch templates for the dropdown
    db.all('SELECT id, name FROM templates ORDER BY name ASC', [], (err, templates) => {
      if (err) {
        console.error('[GET /projects/create] Error fetching templates:', err.message);
        req.flash('error', lang.error_fetching_templates || 'Error fetching templates.');
        return res.render('create-project', { templates: [] });
      }
      res.render('create-project', { templates: templates || [] });
    });
  });

  // POST /create (Create project) - Mounted as /projects/create
  router.post('/create', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const { name, template_id } = req.body;
    const projectName = name ? name.trim() : null;

    if (!projectName) {
      req.flash('error', lang.error_project_name_required || 'Project name is required.');
      console.error('[POST /projects/create] Error: Project name not provided.');
      return res.redirect('/projects/create');
    }

    // Check if project name already exists
    db.get('SELECT id FROM projects WHERE name = ?', [projectName], (errCheck, existingProject) => {
        if (errCheck) {
            console.error('[POST /projects/create] Error checking project name:', errCheck.message);
            req.flash('error', lang.error_generic || 'An error occurred while checking the project name.');
            return res.redirect('/projects/create');
        }
        if (existingProject) {
            req.flash('error', lang.error_project_name_exists || 'A project with this name already exists.');
            return res.redirect('/projects/create');
        }

        // Insert the new project
        db.run('INSERT INTO projects (name, status) VALUES (?, ?)', [projectName, 'active'], function(errInsert) {
          if (errInsert) {
            console.error('[POST /projects/create] Error inserting project:', errInsert.message);
            req.flash('error', lang.error_creating_project || 'Error creating project.');
            return res.redirect('/projects/create');
          }

          const newProjectId = this.lastID;
          console.log(`[POST /projects/create] Project '${projectName}' (ID: ${newProjectId}) created.`);

          // If a template was selected, add its expenses
          if (template_id) {
            console.log(`[POST /projects/create] Importing expenses from template ID ${template_id} for project ID ${newProjectId}...`);
            // Fetch expenses from the selected template - INCLUDE 'file'
            db.all('SELECT name, amount, type, creditor_id, iban, notes, file FROM template_expenses WHERE template_id = ?', [template_id], (errTpl, templateExpenses) => { // <-- Added 'file' here
              if (errTpl) {
                console.error(`[POST /projects/create] Error fetching template expenses for template ID ${template_id}:`, errTpl.message);
                req.flash('warning', lang.warning_template_expenses_failed || 'Project created, but failed to add expenses from template.');
                return res.redirect(`/project/${encodeURIComponent(projectName)}`);
              }

              if (templateExpenses && templateExpenses.length > 0) {
                const expenseDate = new Date().toISOString().split('T')[0]; // Default to today

                // Prepare statement for inserting expenses - INCLUDE 'file'
                const insertExpenseStmt = db.prepare(
                  `INSERT INTO expenses (project_id, name, amount, date, type, creditor_id, iban, notes, file, payment_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')` // <-- Added 'file' column and placeholder
                );

                let insertErrors = 0;
                db.serialize(() => {
                  db.run('BEGIN TRANSACTION');
                  templateExpenses.forEach(exp => {
                    // Pass the 'file' value (exp.file) to the statement
                    insertExpenseStmt.run(newProjectId, exp.name, exp.amount, expenseDate, exp.type, exp.creditor_id, exp.iban, exp.notes, exp.file || null, (errRun) => { // <-- Added exp.file here
                        if (errRun) {
                            console.error(`[POST /projects/create] Error inserting template expense '${exp.name}' for project ID ${newProjectId}:`, errRun.message);
                            insertErrors++;
                        }
                    });
                  });
                  insertExpenseStmt.finalize((errFinalize) => {
                      if (errFinalize) {
                          console.error('[POST /projects/create] Error finalizing template expense insert:', errFinalize.message);
                          insertErrors++;
                      }
                  });
                  db.run('COMMIT', (errCommit) => {
                      if (errCommit || insertErrors > 0) {
                          console.error(`[POST /projects/create] Error committing template expenses (${insertErrors} errors). Rolling back.`);
                          db.run('ROLLBACK'); // Attempt rollback
                          req.flash('error', lang.error_adding_template_expenses || 'Project created, but failed to add expenses from template.');
                      } else {
                          console.log(`[POST /projects/create] Added ${templateExpenses.length} expenses (including files) from template ID ${template_id} to project ID ${newProjectId}.`); // <-- Updated log message
                          req.flash('success', lang.success_project_created_with_template || 'Project created successfully with expenses from template.');
                      }
                      res.redirect(`/project/${encodeURIComponent(projectName)}`);
                  });
                });
              } else {
                console.log(`[POST /projects/create] Template ID ${template_id} selected but has no expenses.`);
                req.flash('warning', lang.warning_template_no_expenses || 'Project created, but the selected template has no expenses.');
                res.redirect(`/project/${encodeURIComponent(projectName)}`);
              }
            });
          } else {
            req.flash('success', lang.success_project_created || 'Project created successfully.');
            res.redirect(`/project/${encodeURIComponent(projectName)}`); // Redirect to the new project page
          }
        });
    });
  });

  // GET /:name (Display project details) - Mounted as /project/:name
  router.get('/:name', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const projectName = req.params.name;
    const currentConfig = getConfig(); // <-- Get current config

    getProjectIdByName(db, projectName, (errId, projectId) => {
      if (errId) {
        console.error(`[GET /project/${projectName}] Error getting project ID:`, errId.message);
        req.flash('error', lang.error_project_not_found || 'Project not found.');
        return res.redirect('/projects');
      }

      Promise.all([
        // 1. Fetch Project Details
        new Promise((resolve, reject) => {
          db.get('SELECT * FROM projects WHERE id = ?', [projectId], (err, project) => {
            if (err) return reject(err);
            if (!project) return reject(new Error('Project data not found after getting ID.'));
            resolve(project);
          });
        }),
        // 2. Fetch Expenses with related names
        new Promise((resolve, reject) => {
          const sql = `
            SELECT
              e.*,
              c.name AS creditor_name,
              p.name AS payment_method_name
            FROM expenses e
            LEFT JOIN creditors c ON e.creditor_id = c.id
            LEFT JOIN payments p ON e.payment_id = p.id
            WHERE e.project_id = ?
            ORDER BY e.date DESC, e.id DESC
          `;
          db.all(sql, [projectId], (err, expenses) => {
            if (err) return reject(err);
            resolve(expenses || []);
          });
        }),
        // 3. Fetch Creditors (for dropdowns)
        new Promise((resolve, reject) => {
          db.all('SELECT id, name FROM creditors ORDER BY name ASC', [], (err, creditors) => {
            if (err) return reject(err);
            resolve(creditors || []);
          });
        }),
        // 4. Fetch Payments (for dropdowns)
        new Promise((resolve, reject) => {
          db.all('SELECT id, name, payment_type FROM payments ORDER BY name ASC', [], (err, payments) => {
            if (err) return reject(err);
            resolve(payments || []);
          });
        }),
        // 5. Fetch Templates (for modal)
        new Promise((resolve, reject) => {
          db.all('SELECT id, name FROM templates ORDER BY name ASC', [], (err, templates) => {
            if (err) return reject(err);
            resolve(templates || []);
          });
        })
      ])
      .then(([project, expenses, creditors, payments, templates]) => {

        // Calculate totals (can still be done here for initial display outside table)
        let totalPaid = 0;
        let totalUnpaid = 0;
        let totalAmount = 0;
        expenses.forEach(expense => {
            const amountValue = parseFloat(expense.amount) || 0;
            totalAmount += amountValue;
            // Use 'unpaid' as the status for unpaid items
            if (expense.payment_status === 'paid') totalPaid += amountValue;
            if (expense.payment_status === 'unpaid') totalUnpaid += amountValue;
        });

        res.render('project', {
          title: `${lang.project || 'Project'}: ${project.name}`, // Set title
          project,
          expenses, // Pass expenses array with related names
          creditors,
          payments,
          templates,
          totalAmount, // Pass calculated totals for display outside table
          totalPaid,
          totalUnpaid,
          config: currentConfig, // Pass current config object
          layout: 'layout' // <-- ADICIONE ESTA LINHA
          // lang is already in res.locals
        });
      })
      .catch(err => {
        console.error(`[GET /project/${projectName}] Error fetching project data (Promise.all):`, err.message);
        req.flash('error', lang.error_loading_project || 'Error loading project details.');
        res.redirect('/projects');
      });
    });
  });

  // POST /edit/:id (Update project)
  router.post('/edit/:id', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const projectId = req.params.id;
    // Get origin from the hidden input (if present)
    const { name, status, origin } = req.body;
    const newProjectName = name ? name.trim() : null;
    const newStatus = status;

    // Validate input
    if (!newProjectName) {
      req.flash('error', lang.error_project_name_required || 'Project name is required.');
      return res.redirect(origin === 'project_page' ? `/project/${encodeURIComponent(name)}` : '/projects');
    }
    if (!['active', 'finished'].includes(newStatus)) {
      req.flash('error', lang.error_invalid_status || 'Invalid status selected.');
      return res.redirect(origin === 'project_page' ? `/project/${encodeURIComponent(name)}` : '/projects');
    }

    // Check if the new name conflicts with ANOTHER existing project (excluding itself)
    db.get('SELECT id FROM projects WHERE name = ? AND id != ?', [newProjectName, projectId], (errCheck, existingProject) => {
        if (errCheck) {
            console.error(`[POST /projects/edit/${projectId}] Error checking for conflicting project name:`, errCheck.message);
            req.flash('error', lang.error_generic || 'An error occurred while checking the project name.');
            return res.redirect(origin === 'project_page' ? `/project/${encodeURIComponent(name)}` : '/projects');
        }
        if (existingProject) {
            req.flash('error', lang.error_project_name_exists || 'Another project with this name already exists.');
            return res.redirect(origin === 'project_page' ? `/project/${encodeURIComponent(name)}` : '/projects');
        }

        // Update the project using its ID
        db.run('UPDATE projects SET name = ?, status = ? WHERE id = ?', [newProjectName, newStatus, projectId], function(errUpdate) {
          let redirectUrl = '/projects'; // Default redirect to list

          if (errUpdate) {
            console.error(`[POST /projects/edit/${projectId}] Error updating project:`, errUpdate.message);
            req.flash('error', lang.error_updating_project || 'Error updating project.');
            if (origin === 'project_page') {
                 redirectUrl = `/projects`;
            }
          } else if (this.changes === 0) {
             req.flash('warning', lang.warning_project_not_found_or_no_change || 'Project not found or no changes made.');
             if (origin === 'project_page') {
                 redirectUrl = `/project/${encodeURIComponent(newProjectName)}`;
             }
          } else {
            console.log(`[POST /projects/edit/${projectId}] Project updated to Name: '${newProjectName}', Status: '${newStatus}'.`);
            req.flash('success', lang.success_project_updated || 'Project updated successfully.');
            if (origin === 'project_page') {
              redirectUrl = `/project/${encodeURIComponent(newProjectName)}`;
            }
          }
          res.redirect(redirectUrl);
        });
    });
  });

  // POST /:projectName/expenses/:expenseId/delete (Delete expense)
  router.post('/:projectName/expenses/:expenseId/delete', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    const { projectName, expenseId } = req.params;
    console.warn(`[POST /project/.../expenses/${expenseId}/delete] Attempting to delete expense.`);

    // Get project ID to ensure the expense belongs to the correct project
    getProjectIdByName(db, projectName, (errId, projectId) => {
        if (errId) {
            console.error(`[POST /project/.../expenses/${expenseId}/delete] Error finding project ID:`, errId.message);
            req.flash('error', lang.error_project_not_found || 'Project not found.');
            return res.redirect('/projects');
        }

        // First, get the filename if it exists, verifying project_id
        db.get('SELECT file FROM expenses WHERE id = ? AND project_id = ?', [expenseId, projectId], (errFetch, expense) => {
            if (errFetch) {
                console.error(`[POST /project/.../expenses/${expenseId}/delete] Error fetching expense file (Project ID ${projectId}):`, errFetch.message);
                req.flash('error', lang.error_deleting_expense || 'Error deleting expense.');
                return res.redirect(`/project/${encodeURIComponent(projectName)}`);
            }

            const fileToDelete = expense ? expense.file : null;

            // Delete the expense record, verifying project_id
            db.run('DELETE FROM expenses WHERE id = ? AND project_id = ?', [expenseId, projectId], function(errDelete) {
              if (errDelete) {
                console.error(`[POST /project/.../expenses/${expenseId}/delete] Error deleting expense record from DB (Project ID ${projectId}):`, errDelete.message);
                req.flash('error', lang.error_deleting_expense || 'Error deleting expense.');
              } else if (this.changes === 0) {
                  // Expense not found or didn't belong to this project
                  req.flash('warning', lang.warning_expense_not_found_delete || 'Expense not found.');
              } else {
                // --- Deletion successful, now check file usage ---
                console.log(`[POST /project/.../expenses/${expenseId}/delete] Expense record deleted from DB successfully.`);
                req.flash('success', lang.success_expense_deleted || 'Expense deleted successfully.');

                // If delete was successful and a file existed, check if it's used by templates BEFORE deleting
                if (fileToDelete) {
                  // Check if the file is used in template_expenses
                  db.get('SELECT 1 FROM template_expenses WHERE file = ? LIMIT 1', [fileToDelete], (errCheckTpl, templateUsage) => {
                    if (errCheckTpl) {
                      console.error(`[POST /project/.../expenses/${expenseId}/delete] Error checking template usage for file ${fileToDelete}:`, errCheckTpl.message);
                      // Log error but don't necessarily stop (maybe flash a warning)
                      req.flash('warning', lang.warning_file_check_failed || 'Could not verify template usage for the file.');
                      // Decide if you want to delete the file anyway or keep it safe
                      // Keeping it safe is generally better to avoid breaking templates
                      console.warn(`[POST /project/.../expenses/${expenseId}/delete] Keeping file ${fileToDelete} due to check error.`);

                    } else if (templateUsage) {
                      // File IS used by a template, DO NOT DELETE IT
                      console.log(`[POST /project/.../expenses/${expenseId}/delete] File ${fileToDelete} is also used by a template. Physical file NOT deleted.`);

                    } else {
                      // File is NOT used by any template, safe to delete
                      console.log(`[POST /project/.../expenses/${expenseId}/delete] File ${fileToDelete} is not used by templates. Deleting physical file.`);
                      const filePath = path.join(__dirname, '..', 'uploads', fileToDelete);
                      fs.unlink(filePath, (errUnlink) => {
                        if (errUnlink && errUnlink.code !== 'ENOENT') { // Ignore 'file not found'
                          console.error(`[POST /project/.../expenses/${expenseId}/delete] Error deleting physical file ${fileToDelete}:`, errUnlink.message);
                          req.flash('warning', lang.warning_file_delete_failed || 'Expense record deleted, but failed to delete associated file.');
                        } else if (!errUnlink) {
                            console.log(`[POST /project/.../expenses/${expenseId}/delete] Deleted physical file ${fileToDelete}.`);
                        }
                      });
                    }
                    // Redirect happens after the check (or potential unlink)
                    res.redirect(`/project/${encodeURIComponent(projectName)}`);
                  });
                  return; // IMPORTANT: Prevent the redirect below from running immediately
                }
                // --- End file usage check ---
              }
              // Redirect immediately if no file to check or if DB delete failed/did nothing
              res.redirect(`/project/${encodeURIComponent(projectName)}`);
            });
        });
    });
  });

  // POST /:projectName/add-from-template (Add expenses from template)
  // Note: The route path in server.js is /project/:name/add-from-template
  router.post('/:projectName/add-from-template', requireLogin, (req, res) => {
      const lang = res.locals.lang;
      const projectName = req.params.projectName;
      // Use English field names from the form
      const { template_id, date } = req.body;

      if (!template_id || !date) {
          console.error(`[POST /project/${projectName}/add-from-template] Error: Template ID or Date not provided.`);
          req.flash('error', lang.error_template_and_date_required || 'Template and Date are required.');
          return res.redirect(`/project/${encodeURIComponent(projectName)}`);
      }

      // Get project ID
      getProjectIdByName(db, projectName, (errId, projectId) => {
          if (errId) {
              console.error(`[POST /project/${projectName}/add-from-template] Error finding project ID:`, errId.message);
              req.flash('error', lang.error_project_not_found || 'Project not found.');
              return res.redirect('/projects');
          }

          // Fetch expenses from the selected template - INCLUDE 'file'
          db.all('SELECT name, amount, type, creditor_id, iban, notes, file FROM template_expenses WHERE template_id = ?', [template_id], (errTpl, templateExpenses) => { // <-- Added 'file' here
              if (errTpl) {
                  console.error(`[POST /project/${projectName}/add-from-template] Error fetching template expenses for template ID ${template_id}:`, errTpl.message);
                  req.flash('error', lang.error_fetching_template_expenses || 'Error fetching expenses from template.');
                  return res.redirect(`/project/${encodeURIComponent(projectName)}`);
              }

              if (!templateExpenses || templateExpenses.length === 0) {
                  console.log(`[POST /project/${projectName}/add-from-template] Template ID ${template_id} has no expenses.`);
                  req.flash('warning', lang.warning_template_no_expenses || 'Selected template has no expenses to add.');
                  return res.redirect(`/project/${encodeURIComponent(projectName)}`);
              }

              // Prepare statement for inserting expenses - INCLUDE 'file'
              const insertExpenseStmt = db.prepare(
                  `INSERT INTO expenses (project_id, name, amount, date, type, creditor_id, iban, notes, file, payment_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')` // <-- Added 'file' column and placeholder
              );

              let insertErrors = 0;
              db.serialize(() => {
                  db.run('BEGIN TRANSACTION');
                  templateExpenses.forEach(exp => {
                      // Use the date provided in the modal form for all expenses in this batch
                      // Pass the 'file' value (exp.file) to the statement
                      insertExpenseStmt.run(projectId, exp.name, exp.amount, date, exp.type, exp.creditor_id, exp.iban, exp.notes, exp.file || null, (errRun) => { // <-- Added exp.file here
                          if (errRun) {
                              console.error(`[POST /project/${projectName}/add-from-template] Error inserting expense '${exp.name}' for project ID ${projectId}:`, errRun.message);
                              insertErrors++;
                          }
                      });
                  });
                  insertExpenseStmt.finalize((errFinalize) => {
                      if (errFinalize) {
                          console.error(`[POST /project/${projectName}/add-from-template] Error finalizing insert statement:`, errFinalize.message);
                          insertErrors++; // Count finalize error as well
                      }
                  });
                  db.run('COMMIT', (errCommit) => {
                      if (errCommit || insertErrors > 0) {
                          console.error(`[POST /project/${projectName}/add-from-template] Error committing transaction or during inserts (${insertErrors} errors). Rolling back.`);
                          db.run('ROLLBACK'); // Attempt rollback
                          req.flash('error', lang.error_adding_template_expenses || 'An error occurred while adding expenses from the template.');
                      } else {
                          console.log(`[POST /project/${projectName}/add-from-template] Added ${templateExpenses.length} expenses (including files) from template ID ${template_id} to project ID ${projectId} with date ${date}.`);
                          req.flash('success', lang.success_template_expenses_added || 'Expenses from template added successfully.');
                      }
                      res.redirect(`/project/${encodeURIComponent(projectName)}`);
                  });
              });
          });
      });
  });

  return router;
};