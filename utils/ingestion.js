import csv from 'csv-parser';
import fs from 'fs';
import Transaction from '../models/Transaction.js';

// Parse CSV file to array of objects
export const parseCSVFile = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        // Trim keys and values to handle leading/trailing spaces
        const cleanedData = {};
        for (const key in data) {
          cleanedData[key.trim()] = data[key] ? data[key].trim() : '';
        }
        results.push(cleanedData);
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
};

// Map asset name aliases
export const standardizeAsset = (asset) => {
  if (!asset) return '';
  const upper = asset.toUpperCase();
  const aliasMap = {
    'BITCOIN': 'BTC',
    'ETHEREUM': 'ETH',
    'TETHER': 'USDT',
    'POLYGON': 'MATIC',
    'CHAINLINK': 'LINK'
  };
  return aliasMap[upper] || upper;
};

// Validate and ingest transaction records for a reconciliation run
export const ingestTransactions = async (filePath, source, runId) => {
  console.log(`Ingesting ${source} transactions for run ${runId} from ${filePath}...`);
  const rawRows = await parseCSVFile(filePath);
  
  const processedDocs = [];
  const seenIds = new Set();
  let qualityIssuesCount = 0;

  for (const row of rawRows) {
    const txId = row.transaction_id || '';
    const rawTimestamp = row.timestamp || '';
    const rawType = row.type || '';
    const rawAsset = row.asset || '';
    const rawQty = row.quantity || '';
    const rawPrice = row.price_usd || '';
    const rawFee = row.fee || '';
    const rawNote = row.note || '';

    let isValid = true;
    let validationError = null;

    // 1. Check duplicate ID within this file/run
    if (txId && seenIds.has(txId)) {
      isValid = false;
      validationError = 'Duplicate transaction ID';
    } else if (txId) {
      seenIds.add(txId);
    } else {
      isValid = false;
      validationError = 'Missing transaction ID';
    }

    // 2. Validate timestamp
    if (isValid) {
      if (!rawTimestamp) {
        isValid = false;
        validationError = 'Missing timestamp';
      } else {
        const parsedTime = Date.parse(rawTimestamp);
        const hasTime = rawTimestamp.includes('T') && rawTimestamp.length > 11;
        if (isNaN(parsedTime) || !hasTime) {
          isValid = false;
          validationError = 'Malformed timestamp';
        }
      }
    }

    // 3. Validate quantity
    let quantity = 0;
    if (isValid) {
      if (!rawQty) {
        isValid = false;
        validationError = 'Missing quantity';
      } else {
        quantity = parseFloat(rawQty);
        if (isNaN(quantity)) {
          isValid = false;
          validationError = 'Quantity is not a number';
        } else if (quantity < 0) {
          isValid = false;
          validationError = 'Negative quantity';
        }
      }
    }

    // 4. Validate Asset and Type
    if (isValid && !rawAsset) {
      isValid = false;
      validationError = 'Missing asset';
    }
    if (isValid && !rawType) {
      isValid = false;
      validationError = 'Missing type';
    }

    // 5. Standardize asset and parse numbers
    const standardizedAsset = standardizeAsset(rawAsset);
    const priceUsd = rawPrice ? parseFloat(rawPrice) : 0;
    const fee = rawFee ? parseFloat(rawFee) : 0;

    if (!isValid) {
      qualityIssuesCount++;
    }

    processedDocs.push({
      runId,
      source,
      transaction_id: txId,
      timestamp: rawTimestamp,
      type: rawType.toUpperCase(),
      asset: standardizedAsset,
      quantity: isNaN(quantity) ? 0 : quantity,
      price_usd: isNaN(priceUsd) ? 0 : priceUsd,
      fee: isNaN(fee) ? 0 : fee,
      note: rawNote,
      isValid,
      validationError
    });
  }

  // Bulk insert using separate Transaction model
  if (processedDocs.length > 0) {
    await Transaction.insertMany(processedDocs);
  }

  console.log(`Ingested ${processedDocs.length} rows for ${source}. Invalid rows: ${qualityIssuesCount}`);
  return {
    total: processedDocs.length,
    valid: processedDocs.length - qualityIssuesCount,
    invalid: qualityIssuesCount
  };
};
