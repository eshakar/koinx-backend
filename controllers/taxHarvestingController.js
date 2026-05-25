import Holding from '../models/Holding.js';
import CapitalGain from '../models/CapitalGain.js';

export const getHoldings = async (req, res) => {
  try {
    const holdings = await Holding.find({});
    res.json(holdings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch holdings', details: error.message });
  }
};

export const getCapitalGains = async (req, res) => {
  try {
    const gains = await CapitalGain.findOne({});
    // Return wrapped in the requested structure
    res.json({ capitalGains: gains });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch capital gains', details: error.message });
  }
};
