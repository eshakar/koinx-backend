import mongoose from 'mongoose';
import db, { JsonCollection } from '../config/db.js';

const HoldingSchema = new mongoose.Schema({
  coin: String,
  coinName: String,
  logo: String,
  currentPrice: Number,
  totalHolding: Number,
  averageBuyPrice: Number,
  stcg: {
    balance: Number,
    gain: Number
  },
  ltcg: {
    balance: Number,
    gain: Number
  }
}, { timestamps: true });

const HoldingModel = db.isMongo()
  ? mongoose.model('Holding', HoldingSchema)
  : new JsonCollection('holdings');

export default HoldingModel;
