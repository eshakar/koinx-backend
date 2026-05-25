import mongoose from 'mongoose';
import db, { JsonCollection } from '../config/db.js';

const TransactionSchema = new mongoose.Schema({
  runId: String,
  source: String, // 'user' | 'exchange'
  transaction_id: String,
  timestamp: String,
  type: String,
  asset: String,
  quantity: Number,
  price_usd: Number,
  fee: Number,
  note: String,
  isValid: Boolean,
  validationError: String
}, { timestamps: true });

const TransactionModel = db.isMongo()
  ? mongoose.model('Transaction', TransactionSchema)
  : new JsonCollection('transactions');

export default TransactionModel;
