import mongoose from 'mongoose';
import db, { JsonCollection } from '../config/db.js';

const ReconciliationReportItemSchema = new mongoose.Schema({
  runId: String,
  category: String, // 'Matched' | 'Conflicting' | 'Unmatched (User only)' | 'Unmatched (Exchange only)'
  userTransaction: Object,
  exchangeTransaction: Object,
  reason: String
}, { timestamps: true });

const ReconciliationReportItemModel = db.isMongo()
  ? mongoose.model('ReconciliationReportItem', ReconciliationReportItemSchema)
  : new JsonCollection('report_items');

export default ReconciliationReportItemModel;
