const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Module expects functions to get/update config, lang object, locale getter, and auth middleware
module.exports = (getConfig, updateConfigAndGlobals, lang, getDefaultLocale, authMiddleware) => {

    // GET /settings - Display the settings page
    router.get('/', authMiddleware.requireLogin, (req, res) => {
        const currentConfig = getConfig(); // Get the current configuration object
        res.render('settings', { // Render the settings view
            title: res.locals.lang?.config_title || 'Settings', // Page title from lang file or default
            config: currentConfig, // Pass current config to the view
            lang: res.locals.lang, // Pass the language object
            currentLocale: getDefaultLocale(), // Pass the current default locale
            user: req.session.user // Pass user session data
        });
    });

    // POST /settings - Handle saving updated settings
    router.post('/', authMiddleware.requireLogin, (req, res) => {
        // Get the submitted values from the form body
        const { DEFAULT_LOCALE, DEFAULT_CURRENCY } = req.body;
        // Define the path to the config.js file
        const configPath = path.join(__dirname, '..', 'config.js');
        // Get the configuration object before changes
        const oldConfig = getConfig();

        // Validate the submitted locale against allowed values
        const allowedLocales = ['pt', 'en', 'fr'];
        const newLocale = allowedLocales.includes(DEFAULT_LOCALE)
            ? DEFAULT_LOCALE // Use submitted value if allowed
            : oldConfig.DEFAULT_LOCALE; // Otherwise, keep the old value

        // Validate the submitted currency against allowed values
        const allowedCurrencies = ['BRL', 'USD', 'EUR', 'CHF', 'GBP']; // Add more if needed
        const newCurrency = allowedCurrencies.includes(DEFAULT_CURRENCY)
            ? DEFAULT_CURRENCY // Use submitted value if allowed
            : oldConfig.DEFAULT_CURRENCY; // Otherwise, keep the old value

        // Create the new configuration object
        const newConfig = {
            DEFAULT_LOCALE: newLocale,
            DEFAULT_CURRENCY: newCurrency
            // Add other config options here if they exist in config.js
        };

        // Format the new configuration object as a string for writing to config.js
        const configContent = `module.exports = ${JSON.stringify(newConfig, null, 2)};\n`;

        // Write the new content to config.js, overwriting the existing file
        fs.writeFile(configPath, configContent, 'utf8', (err) => {
            if (err) {
                // Handle file writing errors
                console.error("Error saving config.js:", err);
                // Use flash message from lang file or default
                req.flash('error', res.locals.lang?.error_saving_settings || 'Error saving settings.');
                return res.redirect('/settings'); // Redirect back to settings page
            }

            // Log success and trigger the function to update global config/lang variables
            console.log("config.js file updated successfully.");
            updateConfigAndGlobals(); // Reload config and language files globally

            // Update the current user's session language to reflect the change immediately
            req.session.lang = newLocale; // NEW - Correct property name matching locals.js
            console.log(`[POST /settings] Updated session lang for user ${req.session.user?.username} to '${newLocale}'.`); // NEW log (optional change)

            // Explicitly save the session before redirecting
            req.session.save((saveErr) => {
                if (saveErr) {
                    // Log error if session saving fails
                    console.error("[POST /settings] Error saving session after language update:", saveErr);
                    req.flash('error', res.locals.lang?.error_saving_session || 'Error saving session settings.');
                    // Still redirect even if save fails? Or handle differently?
                    return res.redirect('/settings');
                }
                // Session saved successfully, now redirect
                console.log("[POST /settings] Session saved successfully after lang update.");
                req.flash('success', res.locals.lang?.settings_saved_success || 'Settings saved successfully.');
                res.redirect('/settings');
            });
        });
    });

    return router; // Return the configured router instance
};