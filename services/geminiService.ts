import { GoogleGenAI, Type } from "@google/genai";
import { Player, Card, GameState } from '../types';
import { evaluateHand, analyzeHand, getBoardTexture } from '../utils/pokerLogic';

let aiClient: GoogleGenAI | null = null;

const initClient = () => {
  if (!aiClient && process.env.API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
};

export interface AIAction {
  action: 'check' | 'call' | 'raise' | 'fold';
  amount?: number; // Total amount to bet/raise to
  reasoning?: string;
}

// --- Offline GTO-Lite Logic (V2) ---

const getOfflineDecision = (
    player: Player,
    gameState: GameState,
    validActions: string[],
    minRaiseAmount: number
): AIAction => {
    const analysis = analyzeHand(player.hand, gameState.communityCards, gameState.stage);
    const toCall = gameState.currentBet - player.currentBet;
    const potOdds = toCall / (gameState.pot + toCall);
    const texture = getBoardTexture(gameState.communityCards);
    
    // Context
    const relPos = (gameState.players.findIndex(p => p.id === player.id) - gameState.dealerIndex + 8) % 8;
    const isLatePosition = relPos === 0 || relPos === 7; // BTN or CO
    const isAggressor = gameState.lastAggressorIndex === player.id;
    const activeOpponents = gameState.players.filter(p => p.status === 'active' && p.id !== player.id).length;
    
    const canCheck = toCall === 0;
    const canRaise = validActions.includes('raise');
    const rand = Math.random();

    // 0. Anti-Loop / Pot Commitment
    const stackRatio = player.totalInvested / (player.chips + player.totalInvested);
    if (stackRatio > 0.4 && analysis.rankValue >= 1) { 
        return canCheck ? { action: 'check' } : { action: 'call' }; 
    }
    
    // 1. Preflop Strategy
    if (gameState.stage === 'preflop') {
        const c1 = player.hand[0];
        const c2 = player.hand[1];
        const isPair = c1.value === c2.value;
        const highVal = Math.max(c1.value, c2.value);
        const lowVal = Math.min(c1.value, c2.value);
        const isSuited = c1.suit === c2.suit;
        
        let score = highVal;
        if (isPair) score *= 2.2; // Increase weight of pairs
        if (isSuited) score += 2.5;
        const gap = highVal - lowVal;
        if (gap === 1) score += 1.5;
        else if (gap === 2) score -= 0.5;
        else if (gap > 2) score -= 2; 

        // RFI (Raise First In) Thresholds
        let raiseThreshold = 22; // Tight-ish
        let callThreshold = 14;

        // Positional Adjustments
        if (isLatePosition) { raiseThreshold -= 5; callThreshold -= 4; } 
        if (toCall > 0) { raiseThreshold += 5; callThreshold += 3; } // Tighter vs raise
        
        if (score >= raiseThreshold && canRaise) {
            // Sizing: 3x usually, larger if out of position
            // Ensure we don't just min-raise (currentBet + minRaise) unless active pot is huge
            const factor = isLatePosition ? 2.5 : 3.5; 
            let amount = Math.floor(gameState.currentBet * factor);
            
            // If opening (currentBet == BB), open to 3BB
            if (gameState.currentBet === gameState.minRaise) amount = gameState.minRaise * 3;
            
            // Fix min-raise logic: Try to raise at least 2.5x the previous raise increment if possible
            const minLegal = gameState.currentBet + minRaiseAmount;
            if (amount < minLegal + minRaiseAmount) amount = minLegal + minRaiseAmount;

            // Randomly just call with strong but not premium hands to trap/balance
            if (!isPair && rand < 0.2 && toCall > 0) return { action: 'call' };

            return { action: 'raise', amount };
        }
        if (score >= callThreshold) {
             return { action: canCheck ? 'check' : 'call' };
        }
        return { action: canCheck ? 'check' : 'fold' };
    }

    // 2. Postflop Logic
    
    // Equity Calculation
    let outs = analysis.outs;
    const isBoardPaired = new Set(gameState.communityCards.map(c => c.value)).size < gameState.communityCards.length;
    if (isBoardPaired) outs = Math.max(0, outs - 2);

    let estimatedEquity = 0;
    if (gameState.stage === 'flop') estimatedEquity = outs * 0.04; 
    else if (gameState.stage === 'turn') estimatedEquity = outs * 0.02;

    let showdownEquity = 0;
    if (analysis.rankValue === 0) showdownEquity = 0; // High card
    else if (analysis.rankValue === 1) { 
         if (analysis.description.includes("Top Pair")) showdownEquity = 0.80;
         else if (analysis.description.includes("Middle Pair")) showdownEquity = 0.55;
         else showdownEquity = 0.35;
    } else if (analysis.rankValue >= 2) {
        showdownEquity = 0.95;
    }
    
    const totalEquity = Math.max(estimatedEquity, showdownEquity);

    // --- C-Betting Logic (The Fix) ---
    // If we were the aggressor, we check if we should "C-Bet" (Continuation Bet)
    // even with a mediocre hand, depending on board texture.
    if (isAggressor && canRaise && gameState.currentBet === 0) {
        // Dry Board: C-bet frequency high (70%) because we have range advantage
        if (texture === 'dry' || texture === 'neutral') {
            if (rand < 0.70) {
                // Bet small (33% pot) on dry boards
                const betSize = Math.floor(gameState.pot * 0.33);
                return { action: 'raise', amount: gameState.currentBet + betSize };
            }
        }
        // Wet Board: C-bet frequency lower (40%), mainly for value or strong draws
        else {
            const hasValue = totalEquity > 0.6; // Top pair+ or big draw
            if (hasValue && rand < 0.8) {
                // Bet larger (66% pot) to charge draws
                const betSize = Math.floor(gameState.pot * 0.66);
                return { action: 'raise', amount: gameState.currentBet + betSize };
            }
        }
        // If we didn't c-bet, we check.
        return { action: 'check' };
    }

    // --- Standard Postflop Play (Facing Bet or Not Aggressor) ---

    // 1. Monsters (Set+)
    if (analysis.rankValue >= 3) {
        // Slowplay on dry boards vs aggressive opponents?
        if (texture === 'dry' && rand < 0.3 && canCheck) return { action: 'check' };
        
        // Fast play on wet boards
        if (canRaise) {
             const betSize = Math.floor((gameState.pot + toCall) * 0.75);
             return { action: 'raise', amount: gameState.currentBet + betSize };
        }
        return { action: 'call' };
    }

    // 2. Strong Top Pair / Overpair
    if (analysis.rankValue >= 2 || (analysis.rankValue === 1 && analysis.description.includes("Top"))) {
        if (toCall > 0) {
             // Just call if board is very wet and we don't have the nuts
             if (texture === 'very-wet' && analysis.rankValue < 3) return { action: 'call' };
             // Raise for value if bet is small
             if (canRaise && toCall < gameState.pot * 0.3 && rand < 0.4) {
                 return { action: 'raise', amount: gameState.currentBet + Math.floor(gameState.pot * 0.6) };
             }
             return { action: 'call' };
        } else if (canRaise) {
            // Value bet
            return { action: 'raise', amount: gameState.currentBet + Math.floor(gameState.pot * 0.5) };
        }
    }

    // 3. Draws
    if (estimatedEquity > 0.25) { // 8+ outs roughly
        // Semi-bluff raise on turn or flop
        if (canRaise && rand < 0.3 && activeOpponents <= 2) {
             return { action: 'raise', amount: gameState.currentBet + Math.floor(gameState.pot * 0.6) };
        }
        // Call if odds are decent
        if (totalEquity > potOdds - 0.05) return { action: 'call' };
    }

    // 4. Weak/Air
    if (canCheck) return { action: 'check' };
    
    // Pot Odds Call (Bluff catching bottom pair or Ace high sometimes)
    if (totalEquity > potOdds + 0.1) return { action: 'call' };

    return { action: 'fold' };
};


// --- Main Entry Point ---

export const getAIDecision = async (
  player: Player,
  gameState: GameState,
  validActions: string[],
  minRaiseAmount: number
): Promise<AIAction> => {
  
  const toCall = gameState.currentBet - player.currentBet;
  
  // 1. Pre-validation of mode
  let decision: AIAction;

  if (gameState.gameMode === 'offline') {
      decision = getOfflineDecision(player, gameState, validActions, minRaiseAmount);
  } else {
      // Online (Gemini)
      initClient();
      if (!aiClient) {
        decision = getOfflineDecision(player, gameState, validActions, minRaiseAmount);
      } else {
          const analysis = analyzeHand(player.hand, gameState.communityCards, gameState.stage);
          const position = (gameState.players.findIndex(p => p.id === player.id) - gameState.dealerIndex + 8) % 8;
          const potOdds = toCall > 0 ? toCall / (gameState.pot + toCall) : 0;
          const texture = getBoardTexture(gameState.communityCards);
          const isAggressor = gameState.lastAggressorIndex === player.id;
          const minLegal = gameState.currentBet + minRaiseAmount;

          const prompt = `
            You are a professional GTO Poker Bot.
            
            **Game State:**
            - Blinds: $5/$10
            - Stage: ${gameState.stage}
            - Pot: $${gameState.pot}
            - Board: ${gameState.communityCards.map(c => `${c.rank}${c.suit}`).join(', ') || 'None'} (${texture})
            - To Call: $${toCall}
            - Min Raise Total: $${minLegal}
            - Aggressor: ${isAggressor ? "YOU (Initiative)" : "Opponent"}
            
            **Your Hand:**
            - Cards: ${player.hand.map(c => `${c.rank}${c.suit}`).join(', ')}
            - Strength: ${analysis.rankName} (${analysis.description})
            - Draws: ${analysis.draws.join(', ') || 'None'} (Outs: ${analysis.outs})
            - Stack: $${player.chips}
            
            **Strategy:**
            - IF "To Call" > 0, YOU CANNOT CHECK. YOU MUST CALL OR FOLD.
            - DO NOT MIN-RAISE. If you raise, raise to at least ${minLegal + minRaiseAmount} or 60% Pot. Avoid click-backs.
            
            **Valid Actions:** [${validActions.join(', ')}]
        
            Respond in JSON: { "action": "check"|"call"|"raise"|"fold", "amount": number }
          `;

          try {
            const response = await aiClient.models.generateContent({
              model: "gemini-2.5-flash",
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    action: { type: Type.STRING, enum: ["check", "call", "fold", "raise"] },
                    amount: { type: Type.NUMBER },
                    reasoning: { type: Type.STRING }
                  },
                  required: ["action"]
                }
              }
            });
            decision = JSON.parse(response.text) as AIAction;
          } catch (error) {
            console.error("AI Error, falling back to offline", error);
            decision = getOfflineDecision(player, gameState, validActions, minRaiseAmount);
          }
      }
  }

  // --- STRICT SANITIZATION & RULES ENFORCEMENT ---
  
  // 1. Prevent Illegal Checks
  if (decision.action === 'check' && toCall > 0) {
      console.warn(`Illegal Check detected for ${player.name}. Converting...`);
      // Decide based on simple equity logic if AI messed up
      const analysis = analyzeHand(player.hand, gameState.communityCards, gameState.stage);
      // Call if good hand, Fold if trash
      const isWorthCalling = analysis.rankValue >= 1 || analysis.outs >= 6;
      decision.action = isWorthCalling ? 'call' : 'fold';
      decision.reasoning = "Auto-corrected illegal check";
  }

  // 2. Prevent Illegal Calls (insufficient funds is handled in App, but good to check)
  
  // 3. Fix Raise Sizing (Anti-Min-Raise)
  if (decision.action === 'raise') {
      const minLegalRaiseTotal = gameState.currentBet + minRaiseAmount;
      const maxChips = player.chips + player.currentBet;
      
      let targetAmount = decision.amount || 0;
      
      // Heuristic: If raising, avoid min-raises unless all-in.
      // Force raise to be at least (CurrentBet + 1.5x RaiseIncrement) to drive action
      const preferredMinRaise = gameState.currentBet + Math.ceil(minRaiseAmount * 2.0);
      
      if (targetAmount < preferredMinRaise) {
          targetAmount = preferredMinRaise;
      }
      
      // Hard clamp to rules
      if (targetAmount < minLegalRaiseTotal) targetAmount = minLegalRaiseTotal;
      if (targetAmount > maxChips) targetAmount = maxChips;

      // If we are capped by chips and amount < minLegal, we are effectively all-in (which is allowed)
      // but if we have chips, we must ensure minLegal.
      if (maxChips >= minLegalRaiseTotal && targetAmount < minLegalRaiseTotal) {
          targetAmount = minLegalRaiseTotal;
      }

      decision.amount = targetAmount;
  }

  return decision;
};