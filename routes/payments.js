const express = require('express');

// Helper function to fetch countries and currencies (cached)
let cachedFormData = null;
let isFetchingFormData = false;
async function getFormData() {
  if (cachedFormData) {
    return cachedFormData;
  }
  if (isFetchingFormData) {
    // Wait for the ongoing fetch to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    return getFormData(); // Retry after waiting
  }

  isFetchingFormData = true;
  console.log("Fetching fresh form data (countries/currencies)...");
  try {
    const fetch = (await import('node-fetch')).default; // Dynamic import

    // Fetch countries
    const countriesRes = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2');
    if (!countriesRes.ok) throw new Error(`REST Countries API error: ${countriesRes.statusText}`);
    const countriesData = await countriesRes.json();
    const countries = countriesData
      .map(country => ({ code: country.cca2, name: country.name.common }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort by name

    // Fetch currencies (Example using ExchangeRate-API - Consider a more stable source/caching)
    const currenciesRes = await fetch('https://api.exchangerate-api.com/v4/latest/USD'); // Base USD example
    if (!currenciesRes.ok) throw new Error(`ExchangeRate API error: ${currenciesRes.statusText}`);
    const currenciesData = await currenciesRes.json();
    const currencies = Object.keys(currenciesData.rates)
      .map(code => ({ code: code, name: code })) // Use code as name for simplicity
      .sort((a, b) => a.code.localeCompare(b.code)); // Sort by code

    cachedFormData = { countries, currencies };
    console.log("Form data fetched and cached.");
    isFetchingFormData = false;
    return cachedFormData;
  } catch (error) {
    console.error('[getFormData] Error fetching data:', error.message);
    isFetchingFormData = false;
    return { countries: [], currencies: [] }; // Return empty arrays on error
  }
}

module.exports = (db, authMiddleware) => {
  const router = express.Router();
  const { requireLogin /*, requireAdmin */ } = authMiddleware;

  // GET /payments (List payment methods)
  router.get('/', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    // Use correct table 'payments' and order by 'name'
    db.all('SELECT * FROM payments ORDER BY name ASC', (err, payments) => {
      if (err) {
        console.error('[GET /payments] Error fetching payment methods:', err.message);
        req.flash('error', lang.error_fetching_payments || 'Error fetching payment methods.');
        return res.render('payments-methods', { payments: [] }); // Render page even on error
      }
      // Render the view, passing payments data. lang is already in res.locals.
      // Countries/currencies will be loaded via JS for the modals.
      res.render('payments-methods', {
        payments: payments || []
      });
    });
  });

  // GET /payments/form-data (Internal API to fetch countries/currencies for forms)
  router.get('/form-data', requireLogin, async (req, res) => {
    const data = await getFormData();
    // Check if fetching failed completely
    if (!data.countries.length && !data.currencies.length && !cachedFormData) {
        return res.status(500).json({ error: 'Failed to load form data.' });
    }
    res.json(data); // Return data (possibly cached) as JSON
  });

  // POST /payments (Add new payment method)
  router.post('/', requireLogin, (req, res) => {
    const lang = res.locals.lang;
    // Get fields from form using ENGLISH names
    const {
      payment_type, // 'bank_account', 'credit_card', 'cash'
      name,         // Name for bank account
      bank,         // Bank name (used for bank_account and credit_card)
      reference,    // Account number or Card number
      account_type, // 'checking', 'savings'
      currency,     // Currency for bank account
      country,      // Country for bank account
      card_name,    // Name for credit card
      cash_currency // Currency for cash
    } = req.body;

    // Validate payment_type
    if (!['bank_account', 'credit_card', 'cash'].includes(payment_type)) {
        req.flash('error', lang.error_invalid_payment_type || 'Invalid payment type selected.');
        return res.redirect('/payments');
    }

    // Sanitize and prepare data for DB insertion based on payment_type
    let dbName = '';
    let dbReference = null;
    let dbBank = null;
    let dbAccountType = null;
    let dbCountry = null;
    let dbCurrency = null;

    const sanitize = (field) => (field && typeof field === 'string') ? field.trim() : null; // Trim or null

    try {
        if (payment_type === 'bank_account') {
            dbName = sanitize(name);
            dbReference = sanitize(reference);
            dbBank = sanitize(bank);
            dbAccountType = sanitize(account_type); // Should be 'checking' or 'savings'
            dbCountry = sanitize(country);
            dbCurrency = sanitize(currency);

            // Validation
            if (!dbName || !dbReference || !dbBank || !dbAccountType || !dbCountry || !dbCurrency) {
                throw new Error(lang.error_fill_all_bank || 'Please fill all required fields for Bank Account.');
            }
            if (!['checking', 'savings'].includes(dbAccountType)) {
                throw new Error(lang.error_invalid_account_type || 'Invalid account type selected.');
            }

        } else if (payment_type === 'credit_card') {
            dbName = sanitize(card_name); // Use card_name as the main name
            dbReference = sanitize(reference); // Use reference for card number
            dbBank = sanitize(bank); // Bank/Issuer is optional

            // Validation
            if (!dbName || !dbReference) {
                throw new Error(lang.error_fill_card_details || 'Please fill Name on Card and Card Number.');
            }
            // Other fields remain null

        } else if (payment_type === 'cash') {
            dbName = 'Cash'; // Fixed name for consistency
            dbCurrency = sanitize(cash_currency);

            // Validation
            if (!dbCurrency) {
                throw new Error(lang.error_select_cash_currency || 'Please select the Currency for Cash.');
            }
            // Other fields remain null
        }

        // Insert into the database using correct column names
        db.run(
          `INSERT INTO payments (name, payment_type, reference, bank, account_type, country, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            dbName, payment_type, dbReference, dbBank, dbAccountType, dbCountry, dbCurrency
          ],
          function(err) {
            if (err) {
              console.error('[POST /payments] Error creating payment method:', err.message);
              // Add specific error feedback if possible (e.g., UNIQUE constraint on reference?)
              req.flash('error', lang.error_creating_payment || 'Failed to create payment method.');
            } else {
              console.log(`[POST /payments] Payment method '${dbName}' (ID: ${this.lastID}, Type: ${payment_type}) created.`);
              req.flash('success', lang.success_payment_created || `Payment method '${dbName}' created successfully.`);
            }
            res.redirect('/payments');
          }
        );

    } catch (validationError) {
        console.warn('[POST /payments] Validation Error:', validationError.message);
        req.flash('error', validationError.message); // Show specific validation error
        res.redirect('/payments');
    }
  });

  // POST /payments/:id/edit (Update payment method)
  router.post('/:id/edit', requireLogin, (req, res) => {
    const paymentId = req.params.id;
    const lang = res.locals.lang;
    // Get form data using ENGLISH names
    const {
      // payment_type is not editable, fetch original type
      name, bank, reference, account_type, currency, country, // Bank fields
      card_name, // Card fields (bank, reference shared)
      cash_currency // Cash fields
    } = req.body;

    // Fetch the original payment type first, as it dictates which fields are relevant/saved
    db.get('SELECT payment_type FROM payments WHERE id = ?', [paymentId], (errType, rowType) => {
        if (errType || !rowType) {
            console.error(`[POST /payments/${paymentId}/edit] Error fetching original type or method not found: ${errType?.message}`);
            req.flash('error', lang.error_payment_not_found || 'Payment method not found.');
            return res.redirect('/payments');
        }
        const originalPaymentType = rowType.payment_type;

        // Sanitize and prepare data based on the *original* payment_type
        let dbName = '';
        let dbReference = null;
        let dbBank = null;
        let dbAccountType = null;
        let dbCountry = null;
        let dbCurrency = null;

        const sanitize = (field) => (field && typeof field === 'string') ? field.trim() : null;

        try {
            if (originalPaymentType === 'bank_account') {
                dbName = sanitize(name);
                dbReference = sanitize(reference);
                dbBank = sanitize(bank);
                dbAccountType = sanitize(account_type);
                dbCountry = sanitize(country);
                dbCurrency = sanitize(currency);
                // Validation
                if (!dbName || !dbReference || !dbBank || !dbAccountType || !dbCountry || !dbCurrency) {
                    throw new Error(lang.error_fill_all_bank || 'Please fill all required fields for Bank Account.');
                }
                 if (!['checking', 'savings'].includes(dbAccountType)) {
                    throw new Error(lang.error_invalid_account_type || 'Invalid account type selected.');
                }
            } else if (originalPaymentType === 'credit_card') {
                dbName = sanitize(card_name);
                dbReference = sanitize(reference);
                dbBank = sanitize(bank); // Allow updating bank/issuer
                // Validation
                if (!dbName || !dbReference) {
                    throw new Error(lang.error_fill_card_details || 'Please fill Name on Card and Card Number.');
                }
                // Other fields remain null
            } else if (originalPaymentType === 'cash') {
                dbName = 'Cash'; // Name is fixed
                dbCurrency = sanitize(cash_currency);
                // Validation
                if (!dbCurrency) {
                    throw new Error(lang.error_select_cash_currency || 'Please select the Currency for Cash.');
                }
                // Other fields remain null
            } else {
                 throw new Error(lang.error_invalid_payment_type || 'Invalid original payment type.');
            }

            // Update in the database
            // Use correct table 'payments' and column names
            db.run(
              `UPDATE payments SET name = ?, reference = ?, bank = ?, account_type = ?, country = ?, currency = ?
               WHERE id = ? AND payment_type = ?`, // Add type check for safety
              [
                dbName, dbReference, dbBank, dbAccountType, dbCountry, dbCurrency,
                paymentId, originalPaymentType // Pass original type to WHERE clause
              ],
              function(updateErr) {
                if (updateErr) {
                  console.error(`[POST /payments/${paymentId}/edit] Error updating payment method:`, updateErr.message);
                  req.flash('error', lang.error_updating_payment || 'Error updating payment method.');
                } else if (this.changes > 0) {
                  console.log(`[POST /payments/${paymentId}/edit] Payment method updated successfully.`);
                  req.flash('success', lang.success_payment_updated || 'Payment method updated successfully.');
                } else {
                  console.warn(`[POST /payments/${paymentId}/edit] No rows affected. ID ${paymentId} may not exist or no changes made.`);
                  req.flash('warning', lang.warning_payment_not_found_or_no_change || 'Payment method not found or no changes made.');
                }
                res.redirect('/payments'); // Redirect to the list
              }
            );
        } catch (validationError) {
             console.warn(`[POST /payments/${paymentId}/edit] Validation Error:`, validationError.message);
             req.flash('error', validationError.message); // Show specific validation error
             // It's tricky to redirect back to the modal easily here. Redirecting to list is simpler.
             res.redirect('/payments');
        }
    });
  });

  // POST /payments/:id/delete (Delete payment method)
  router.post('/:id/delete', requireLogin, /* requireAdmin, */ (req, res) => {
    const paymentId = req.params.id;
    const lang = res.locals.lang;
    console.warn(`[POST /payments/${paymentId}/delete] Attempting to delete payment method.`);
    // Foreign key constraint `ON DELETE SET NULL` in `expenses` table handles dissociation.

    // Use correct table 'payments'
    db.run('DELETE FROM payments WHERE id = ?', [paymentId], function(err) {
      if (err) {
        console.error(`[POST /payments/${paymentId}/delete] Error deleting payment method:`, err.message);
        req.flash('error', lang.error_deleting_payment || 'Error deleting payment method.');
      } else if (this.changes > 0) {
        console.log(`[POST /payments/${paymentId}/delete] Payment method deleted successfully.`);
        req.flash('success', lang.success_payment_deleted || 'Payment method deleted successfully.');
      } else {
        console.warn(`[POST /payments/${paymentId}/delete] No rows affected. ID ${paymentId} may not exist.`);
        req.flash('warning', lang.warning_payment_not_found_delete || 'Payment method not found.');
      }
      res.redirect('/payments'); // Redirect to the list
    });
  });

  // GET /payments/:id/json (Internal API to fetch data for JS editing modal)
  router.get('/:id/json', requireLogin, async (req, res) => {
    const paymentId = req.params.id;
    const lang = res.locals.lang;
    // Use correct table 'payments'
    db.get('SELECT * FROM payments WHERE id = ?', [paymentId], async (err, payment) => {
      if (err) {
        console.error(`[GET /payments/${paymentId}/json] Error fetching payment:`, err.message);
        return res.status(500).json({ error: lang.error_fetching_payment || 'Failed to fetch payment method.' });
      }
      if (!payment) {
        return res.status(404).json({ error: lang.error_payment_not_found || 'Payment method not found.' });
      }
      // Return only payment data; form data (countries/currencies) is fetched separately by JS
      res.json({ payment });
    });
  });

  return router;
};