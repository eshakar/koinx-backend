import mongoose from 'mongoose';
import db, { JsonCollection } from '../config/db.js';

const CapitalGainsSchema = new mongoose.Schema({
  stcg: {
    profits: Number,
    losses: Number
  },
  ltcg: {
    profits: Number,
    losses: Number
  }
}, { timestamps: true });

const CapitalGainModel = db.isMongo()
  ? mongoose.model('CapitalGain', CapitalGainsSchema)
  : new JsonCollection('capitalgains');

export default CapitalGainModel;
