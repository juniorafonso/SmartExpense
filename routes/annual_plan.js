const express = require('express');
const router = express.Router();

module.exports = (db, authMiddleware) => {
    const { ensureAuthenticated } = authMiddleware;

    const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
    const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
    const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });

    router.get('/', ensureAuthenticated, async (req, res) => {
        try {
            const items = await dbAll('SELECT * FROM annual_plan_items ORDER BY order_index ASC');
            res.json(items);
        } catch (error) {
            console.error("Error fetching annual plan items:", error);
            res.status(500).json({ message: "Error fetching annual plan items.", error: error.message });
        }
    });

    router.post('/', ensureAuthenticated, async (req, res) => {
        try {
            const maxIndexRow = await dbGet('SELECT MAX(order_index) as max_index FROM annual_plan_items');
            const nextIndex = (maxIndexRow?.max_index ?? -1) + 1;

            const result = await dbRun(
                'INSERT INTO annual_plan_items (month_year, expense_name, expense_amount, deposit_amount, order_index) VALUES (?, ?, ?, ?, ?)',
                ['', '', 0, 0, nextIndex]
            );

            const newItem = await dbGet('SELECT * FROM annual_plan_items WHERE id = ?', [result.lastID]);
            res.status(201).json(newItem);

        } catch (error) {
            console.error("Error adding annual plan item:", error);
            res.status(500).json({ message: "Error adding annual plan item.", error: error.message });
        }
    });

    router.put('/reorder', ensureAuthenticated, async (req, res) => {

        const { item1Id, item2Id, item1, item2 } = req.body;

        if (!item1Id || !item2Id) {
            console.error('Validation failed for /reorder: Missing IDs. Body:', req.body);
            return res.status(400).json({ message: "Missing required item IDs." });
        }
        if (!item1 || typeof item1 !== 'object' || typeof item1.expense_amount !== 'number' || typeof item1.deposit_amount !== 'number') {
            console.error('Validation failed for /reorder: Invalid item1 structure or amounts. Body:', req.body);
            return res.status(400).json({ message: "Invalid structure or missing amounts for item1." });
        }
        if (!item2 || typeof item2 !== 'object' || typeof item2.expense_amount !== 'number' || typeof item2.deposit_amount !== 'number') {
            console.error('Validation failed for /reorder: Invalid item2 structure or amounts. Body:', req.body);
            return res.status(400).json({ message: "Invalid structure or missing amounts for item2." });
        }

        try {
            const item1Data = await dbGet('SELECT id, order_index FROM annual_plan_items WHERE id = ?', [item1Id]);
            const item2Data = await dbGet('SELECT id, order_index FROM annual_plan_items WHERE id = ?', [item2Id]);

            if (!item1Data || !item2Data) {
                console.error(`Items not found for reorder: item1Id=${item1Id}, item2Id=${item2Id}`);
                return res.status(404).json({ message: "One or both items not found." });
            }

            console.log(`Swapping order_index: Item ${item1Id} gets index ${item2Data.order_index}, Item ${item2Id} gets index ${item1Data.order_index}`);
            await dbRun('UPDATE annual_plan_items SET order_index = ? WHERE id = ?', [item2Data.order_index, item1Id]);
            await dbRun('UPDATE annual_plan_items SET order_index = ? WHERE id = ?', [item1Data.order_index, item2Id]);

            console.log(`Items ${item1Id} and ${item2Id} reordered successfully.`);
            res.json({ message: "Items reordered successfully." });

        } catch (error) {
            console.error(`Error during /reorder processing for items ${item1Id}, ${item2Id}:`, error);
            res.status(500).json({ message: "Error reordering items.", error: error.message });
        }
    });

    router.put('/:id', ensureAuthenticated, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            console.error(`Invalid ID format received in PUT /:id: ${req.params.id}`);
            return res.status(400).json({ message: "Invalid ID format." });
        }
        const { month_year, expense_name, expense_amount, deposit_amount } = req.body;

        if (typeof expense_amount !== 'number' || typeof deposit_amount !== 'number') {
            console.error(`Validation failed for PUT /${id}. Body:`, req.body);
            return res.status(400).json({ message: "Expense and Deposit amounts must be numbers." });
        }

        try {
            const result = await dbRun(
                'UPDATE annual_plan_items SET month_year = ?, expense_name = ?, expense_amount = ?, deposit_amount = ? WHERE id = ?',
                [month_year || '', expense_name || '', expense_amount, deposit_amount, id]
            );

            if (result.changes === 0) {
                return res.status(404).json({ message: "Item not found." });
            }
            const updatedItem = await dbGet('SELECT * FROM annual_plan_items WHERE id = ?', [id]);
            res.json(updatedItem);

        } catch (error) {
            console.error(`Error updating annual plan item ${id}:`, error);
            res.status(500).json({ message: "Error updating annual plan item.", error: error.message });
        }
    });

    router.delete('/:id', ensureAuthenticated, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            console.error(`Invalid ID format received in DELETE /:id: ${req.params.id}`);
            return res.status(400).json({ message: "Invalid ID format." });
        }
        try {
            const result = await dbRun('DELETE FROM annual_plan_items WHERE id = ?', [id]);

            if (result.changes === 0) {
                return res.status(404).json({ message: "Item not found." });
            }
            res.status(200).json({ message: "Item deleted successfully." });

        } catch (error) {
            console.error(`Error deleting annual plan item ${id}:`, error);
            res.status(500).json({ message: "Error deleting annual plan item.", error: error.message });
        }
    });

    return router;
};