import Transaction from '../models/Transaction.js';
import ReconciliationRun from '../models/ReconciliationRun.js';
import ReconciliationReportItem from '../models/ReconciliationReportItem.js';

// Helper to check type equivalence
export const typesMatch = (type1, type2) => {
  if (!type1 || !type2) return false;
  const t1 = type1.toUpperCase();
  const t2 = type2.toUpperCase();
  if (t1 === t2) return true;
  if (t1 === 'TRANSFER_OUT' && t2 === 'TRANSFER_IN') return true;
  if (t1 === 'TRANSFER_IN' && t2 === 'TRANSFER_OUT') return true;
  return false;
};

// Core reconciliation matching algorithm
export const runReconciliation = async (runId, config) => {
  const { timestampToleranceSeconds, quantityTolerancePct } = config;
  
  console.log(`Running matching engine for run ${runId} with tolerances: Timestamp=${timestampToleranceSeconds}s, Quantity=${quantityTolerancePct}%`);

  // 1. Fetch valid user and exchange transactions
  const userTxs = await Transaction.find({ runId, source: 'user', isValid: true });
  const exchangeTxs = await Transaction.find({ runId, source: 'exchange', isValid: true });
  
  // Sort user transactions by timestamp to match chronologically
  userTxs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  const matchedExchangeIds = new Set();
  const reportItems = [];
  
  let matchedCount = 0;
  let conflictingCount = 0;
  let unmatchedUserCount = 0;

  for (const userTx of userTxs) {
    const userTime = new Date(userTx.timestamp).getTime();
    
    // Filter exchange transactions that match asset and type mapping and haven't been paired yet
    const candidates = exchangeTxs.filter(ex => 
      !matchedExchangeIds.has(ex.transaction_id) &&
      ex.asset === userTx.asset &&
      typesMatch(userTx.type, ex.type)
    );

    // Step A: Look for a TIGHT MATCH (both timestamp and quantity within tolerance)
    let bestMatch = null;
    let minTimeDiff = Infinity;
    const quantityToleranceFraction = quantityTolerancePct / 100;

    for (const ex of candidates) {
      const exTime = new Date(ex.timestamp).getTime();
      const timeDiffSeconds = Math.abs(userTime - exTime) / 1000;
      const qtyDiffPct = Math.abs(userTx.quantity - ex.quantity) / userTx.quantity;

      if (timeDiffSeconds <= timestampToleranceSeconds && qtyDiffPct <= quantityToleranceFraction) {
        if (timeDiffSeconds < minTimeDiff) {
          minTimeDiff = timeDiffSeconds;
          bestMatch = ex;
        }
      }
    }

    if (bestMatch) {
      matchedExchangeIds.add(bestMatch.transaction_id);
      reportItems.push({
        runId,
        category: 'Matched',
        userTransaction: userTx,
        exchangeTransaction: bestMatch,
        reason: 'Matched successfully within configured tolerances.'
      });
      matchedCount++;
      continue;
    }

    // Step B: Look for a CONFLICTING MATCH (proximity match within 1 hour window, but exceeds tolerance)
    let conflictCandidate = null;
    let minConflictDiff = Infinity;
    const conflictProximityWindow = 3600; // 1 hour window for close proximity conflict detection

    for (const ex of candidates) {
      const exTime = new Date(ex.timestamp).getTime();
      const timeDiffSeconds = Math.abs(userTime - exTime) / 1000;

      if (timeDiffSeconds <= conflictProximityWindow) {
        if (timeDiffSeconds < minConflictDiff) {
          minConflictDiff = timeDiffSeconds;
          conflictCandidate = ex;
        }
      }
    }

    if (conflictCandidate) {
      matchedExchangeIds.add(conflictCandidate.transaction_id);
      
      const exTime = new Date(conflictCandidate.timestamp).getTime();
      const timeDiffSeconds = Math.abs(userTime - exTime) / 1000;
      const qtyDiffPct = Math.abs(userTx.quantity - conflictCandidate.quantity) / userTx.quantity;

      const reasons = [];
      if (timeDiffSeconds > timestampToleranceSeconds) {
        reasons.push(`Timestamp difference of ${timeDiffSeconds.toFixed(0)}s exceeds tolerance (${timestampToleranceSeconds}s)`);
      }
      if (qtyDiffPct > quantityToleranceFraction) {
        reasons.push(`Quantity difference of ${(qtyDiffPct * 100).toFixed(4)}% exceeds tolerance (${quantityTolerancePct.toFixed(4)}%)`);
      }
      const reason = `Conflicting fields: ${reasons.join(' and ')}.`;

      reportItems.push({
        runId,
        category: 'Conflicting',
        userTransaction: userTx,
        exchangeTransaction: conflictCandidate,
        reason
      });
      conflictingCount++;
      continue;
    }

    // Step C: If no match or conflict, it is Unmatched User Only
    reportItems.push({
      runId,
      category: 'Unmatched (User only)',
      userTransaction: userTx,
      exchangeTransaction: null,
      reason: 'No corresponding exchange transaction found within proximity.'
    });
    unmatchedUserCount++;
  }

  // Step D: Identify remaining exchange transactions as Unmatched Exchange Only
  let unmatchedExchangeCount = 0;
  for (const ex of exchangeTxs) {
    if (!matchedExchangeIds.has(ex.transaction_id)) {
      reportItems.push({
        runId,
        category: 'Unmatched (Exchange only)',
        userTransaction: null,
        exchangeTransaction: ex,
        reason: 'No corresponding user transaction found within proximity.'
      });
      unmatchedExchangeCount++;
    }
  }

  // Bulk save report items using modular model
  if (reportItems.length > 0) {
    await ReconciliationReportItem.insertMany(reportItems);
  }

  // Count invalid rows for the summary
  const dataQualityIssues = await Transaction.countDocuments({ runId, isValid: false });

  const summary = {
    matched: matchedCount,
    conflicting: conflictingCount,
    unmatchedUser: unmatchedUserCount,
    unmatchedExchange: unmatchedExchangeCount,
    dataQualityIssues
  };

  // Record reconciliation run metadata
  await ReconciliationRun.create({
    runId,
    timestamp: new Date().toISOString(),
    config: {
      timestampToleranceSeconds,
      quantityTolerancePct
    },
    summary
  });

  console.log(`Reconciliation run ${runId} completed with summary:`, summary);
  return summary;
};
