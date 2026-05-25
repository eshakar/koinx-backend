import mongoose from 'mongoose';
import db, { JsonCollection } from '../config/db.js';

const ReconciliationRunSchema = new mongoose.Schema({
  runId: { type: String, unique: true },
  timestamp: String,
  config: {
    timestampToleranceSeconds: Number,
    quantityTolerancePct: Number
  },
  summary: {
    matched: Number,
    conflicting: Number,
    unmatchedUser: Number,
    unmatchedExchange: Number,
    dataQualityIssues: Number
  }
}, { timestamps: true });

const ReconciliationRunModel = db.isMongo()
  ? mongoose.model('ReconciliationRun', ReconciliationRunSchema)
  : new JsonCollection('runs');

export default ReconciliationRunModel;
