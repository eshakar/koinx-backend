import express from 'express';
import {
  reconcile,
  getReport,
  getSummary,
  getUnmatched,
  getRunsHistory
} from '../controllers/reconciliationController.js';

const router = express.Router();

router.post('/reconcile', reconcile);
router.get('/report/:runId', getReport);
router.get('/report/:runId/summary', getSummary);
router.get('/report/:runId/unmatched', getUnmatched);
router.get('/api/runs', getRunsHistory);

export default router;
