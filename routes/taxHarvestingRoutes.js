import express from 'express';
import { getHoldings, getCapitalGains } from '../controllers/taxHarvestingController.js';

const router = express.Router();

router.get('/api/holdings', getHoldings);
router.get('/api/capital-gains', getCapitalGains);

export default router;
