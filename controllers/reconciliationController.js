import path from 'path';
import fs from 'fs';
import Transaction from '../models/Transaction.js';
import ReconciliationRun from '../models/ReconciliationRun.js';
import ReconciliationReportItem from '../models/ReconciliationReportItem.js';
import { ingestTransactions } from '../utils/ingestion.js';
import { runReconciliation } from '../utils/matchingEngine.js';

// Trigger reconciliation run
export const reconcile = async (req, res) => {
  try {
    const body = req.body || {};
    const timestampTolerance = body.TIMESTAMP_TOLERANCE_SECONDS !== undefined
      ? parseInt(body.TIMESTAMP_TOLERANCE_SECONDS)
      : parseInt(process.env.TIMESTAMP_TOLERANCE_SECONDS || '300');

    const quantityTolerance = body.QUANTITY_TOLERANCE_PCT !== undefined
      ? parseFloat(body.QUANTITY_TOLERANCE_PCT)
      : parseFloat(process.env.QUANTITY_TOLERANCE_PCT || '0.01');

    const runId = `RUN-${Date.now()}`;
    let userCsvPath = path.join(process.cwd(), 'user_transactions.csv');
    let exchangeCsvPath = path.join(process.cwd(), 'exchange_transactions.csv');

    // Fallback if not found in current working directory (checks parent of controllers folder)
    if (!fs.existsSync(userCsvPath)) {
      const currentDir = path.dirname(new URL(import.meta.url).pathname);
      let cleanDir = currentDir;
      if (process.platform === 'win32' && cleanDir.startsWith('/')) {
        cleanDir = cleanDir.substring(1);
      }
      userCsvPath = path.join(cleanDir, '..', 'user_transactions.csv');
      exchangeCsvPath = path.join(cleanDir, '..', 'exchange_transactions.csv');
    }

    // Ingest user transactions
    const userResult = await ingestTransactions(userCsvPath, 'user', runId);
    // Ingest exchange transactions
    const exchangeResult = await ingestTransactions(exchangeCsvPath, 'exchange', runId);

    // Run matching engine
    const summary = await runReconciliation(runId, {
      timestampToleranceSeconds: timestampTolerance,
      quantityTolerancePct: quantityTolerance
    });

    res.json({
      success: true,
      runId,
      config: {
        timestampToleranceSeconds: timestampTolerance,
        quantityTolerancePct: quantityTolerance
      },
      ingestionSummary: {
        user: userResult,
        exchange: exchangeResult
      },
      reconciliationSummary: summary
    });
  } catch (error) {
    res.status(500).json({ error: 'Reconciliation run failed', details: error.message });
  }
};

// Fetch full report in JSON or CSV format
export const getReport = async (req, res) => {
  try {
    const { runId } = req.params;
    const format = req.query.format || (req.headers.accept === 'text/csv' ? 'csv' : 'json');

    const items = await ReconciliationReportItem.find({ runId });

    if (items.length === 0) {
      return res.status(404).json({ error: `No reconciliation items found for runId ${runId}` });
    }

    if (format === 'csv') {
      const headers = [
        'Category',
        'Reason',
        'User Transaction ID',
        'User Timestamp',
        'User Type',
        'User Asset',
        'User Quantity',
        'User Price USD',
        'User Fee',
        'User Note',
        'Exchange Transaction ID',
        'Exchange Timestamp',
        'Exchange Type',
        'Exchange Asset',
        'Exchange Quantity',
        'Exchange Price USD',
        'Exchange Fee',
        'Exchange Note'
      ];

      const escapeCsv = (val) => {
        if (val === undefined || val === null) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvRows = [headers.join(',')];
      for (const item of items) {
        const u = item.userTransaction || {};
        const e = item.exchangeTransaction || {};
        const row = [
          escapeCsv(item.category),
          escapeCsv(item.reason),
          escapeCsv(u.transaction_id),
          escapeCsv(u.timestamp),
          escapeCsv(u.type),
          escapeCsv(u.asset),
          escapeCsv(u.quantity),
          escapeCsv(u.price_usd),
          escapeCsv(u.fee),
          escapeCsv(u.note),
          escapeCsv(e.transaction_id),
          escapeCsv(e.timestamp),
          escapeCsv(e.type),
          escapeCsv(e.asset),
          escapeCsv(e.quantity),
          escapeCsv(e.price_usd),
          escapeCsv(e.fee),
          escapeCsv(e.note)
        ];
        csvRows.push(row.join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=reconciliation_report_${runId}.csv`);
      return res.send(csvRows.join('\n'));
    }

    res.json({ runId, totalItems: items.length, items });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch report', details: error.message });
  }
};

// Fetch summary counts
export const getSummary = async (req, res) => {
  try {
    const { runId } = req.params;
    const run = await ReconciliationRun.findOne({ runId });

    if (!run) {
      return res.status(404).json({ error: `Reconciliation run ${runId} not found` });
    }

    res.json({
      runId,
      timestamp: run.timestamp,
      config: run.config,
      summary: run.summary
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary', details: error.message });
  }
};

// Fetch unmatched items and validation errors
export const getUnmatched = async (req, res) => {
  try {
    const { runId } = req.params;
    
    const items = await ReconciliationReportItem.find({
      runId,
      category: { $in: ['Unmatched (User only)', 'Unmatched (Exchange only)', 'Conflicting'] }
    });

    const invalidUserTxs = await Transaction.find({ runId, source: 'user', isValid: false });
    const invalidExchangeTxs = await Transaction.find({ runId, source: 'exchange', isValid: false });

    res.json({
      runId,
      unmatchedCount: items.length,
      qualityIssuesCount: invalidUserTxs.length + invalidExchangeTxs.length,
      items,
      dataQualityIssues: {
        user: invalidUserTxs,
        exchange: invalidExchangeTxs
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch unmatched items', details: error.message });
  }
};

// Fetch all runs history
export const getRunsHistory = async (req, res) => {
  try {
    const runs = await ReconciliationRun.find({});
    runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch runs history', details: error.message });
  }
};
