import { Card, Rank, Suit, HandRank } from '../types';

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  SUITS.forEach(suit => {
    RANKS.forEach((rank, index) => {
      deck.push({ suit, rank, value: index + 2 });
    });
  });
  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

// Simplified Hand Evaluator
// Returns a numeric score. Higher is better.
export const evaluateHand = (holeCards: Card[], communityCards: Card[]): HandRank => {
  const cards = [...holeCards, ...communityCards].sort((a, b) => b.value - a.value);
  
  const isFlush = (c: Card[]) => {
    const suits = {'hearts': 0, 'diamonds': 0, 'clubs': 0, 'spades': 0};
    c.forEach(card => suits[card.suit]++);
    for (const s in suits) {
      if (suits[s as Suit] >= 5) return s as Suit;
    }
    return null;
  };

  const isStraight = (c: Card[]) => {
    const uniqueValues = Array.from(new Set(c.map(card => card.value))).sort((a, b) => b - a);
    if (uniqueValues.includes(14)) uniqueValues.push(1); 
    
    for (let i = 0; i <= uniqueValues.length - 5; i++) {
      const slice = uniqueValues.slice(i, i + 5);
      if (slice[0] - slice[4] === 4) return slice[0];
    }
    return null;
  };

  const flushSuit = isFlush(cards);
  const flushCards = flushSuit ? cards.filter(c => c.suit === flushSuit) : [];
  const straightHigh = isStraight(cards);
  const straightFlushHigh = flushSuit ? isStraight(flushCards) : null;

  const counts: Record<number, number> = {};
  cards.forEach(c => counts[c.value] = (counts[c.value] || 0) + 1);
  
  const fourOfAKind = Object.keys(counts).find(key => counts[parseInt(key)] === 4);
  const threeOfAKind = Object.keys(counts).filter(key => counts[parseInt(key)] === 3).sort((a,b) => parseInt(b)-parseInt(a));
  const pairs = Object.keys(counts).filter(key => counts[parseInt(key)] === 2).sort((a,b) => parseInt(b)-parseInt(a));

  if (straightFlushHigh) return { rank: 8, name: 'Straight Flush', score: 8000000 + straightFlushHigh };
  if (fourOfAKind) {
    const kicker = cards.find(c => c.value !== parseInt(fourOfAKind))?.value || 0;
    return { rank: 7, name: 'Four of a Kind', score: 7000000 + parseInt(fourOfAKind) * 100 + kicker };
  }
  if (threeOfAKind.length > 0 && (threeOfAKind.length > 1 || pairs.length > 0)) {
    const trip = parseInt(threeOfAKind[0]);
    const pair = threeOfAKind.length > 1 ? parseInt(threeOfAKind[1]) : parseInt(pairs[0]);
    return { rank: 6, name: 'Full House', score: 6000000 + trip * 100 + pair };
  }
  if (flushSuit) {
    const score = flushCards.slice(0, 5).reduce((acc, c, i) => acc + c.value * Math.pow(15, 4 - i), 0);
    return { rank: 5, name: 'Flush', score: 5000000 + score };
  }
  if (straightHigh) return { rank: 4, name: 'Straight', score: 4000000 + straightHigh };
  if (threeOfAKind.length > 0) {
    const trip = parseInt(threeOfAKind[0]);
    const kickers = cards.filter(c => c.value !== trip).slice(0, 2);
    return { rank: 3, name: 'Three of a Kind', score: 3000000 + trip * 1000 + kickers[0].value * 15 + kickers[1].value };
  }
  if (pairs.length >= 2) {
    const p1 = parseInt(pairs[0]);
    const p2 = parseInt(pairs[1]);
    const kicker = cards.find(c => c.value !== p1 && c.value !== p2)?.value || 0;
    return { rank: 2, name: 'Two Pair', score: 2000000 + p1 * 200 + p2 * 15 + kicker };
  }
  if (pairs.length > 0) {
    const p1 = parseInt(pairs[0]);
    const kickers = cards.filter(c => c.value !== p1).slice(0, 3).reduce((acc, c, i) => acc + c.value * Math.pow(15, 2 - i), 0);
    return { rank: 1, name: 'Pair', score: 1000000 + p1 * 5000 + kickers };
  }
  const highCardScore = cards.slice(0, 5).reduce((acc, c, i) => acc + c.value * Math.pow(15, 4 - i), 0);
  return { rank: 0, name: 'High Card', score: highCardScore };
};

// Advanced Analysis for AI
export interface HandAnalysis {
    description: string;
    draws: string[];
    outs: number;
    rankName: string;
    rankValue: number;
}

export type BoardTexture = 'dry' | 'neutral' | 'wet' | 'very-wet';

export const getBoardTexture = (communityCards: Card[]): BoardTexture => {
    if (communityCards.length < 3) return 'neutral';
    
    const suits: Record<string, number> = {};
    const values = communityCards.map(c => c.value).sort((a,b) => a-b);
    communityCards.forEach(c => suits[c.suit] = (suits[c.suit] || 0) + 1);
    
    const maxSuits = Math.max(...Object.values(suits));
    
    // Connectedness check
    let connectedCount = 1;
    let maxConnected = 1;
    for(let i=0; i<values.length-1; i++) {
        if(values[i+1] - values[i] === 1) connectedCount++;
        else if (values[i+1] !== values[i]) connectedCount = 1;
        maxConnected = Math.max(maxConnected, connectedCount);
    }
    
    if (maxSuits >= 3 || maxConnected >= 3) return 'very-wet';
    if (maxSuits === 2 && maxConnected === 2) return 'wet';
    if (values[values.length-1] >= 11 && maxSuits < 3 && maxConnected < 2) return 'dry'; // High cards, uncoordinated
    
    return 'neutral';
};

export const analyzeHand = (holeCards: Card[], communityCards: Card[], stage: string): HandAnalysis => {
    const handRank = evaluateHand(holeCards, communityCards);
    const allCards = [...holeCards, ...communityCards];
    const draws: string[] = [];
    let outs = 0;
    let description = handRank.name;

    // Preflop Analysis
    if (stage === 'preflop' && holeCards.length === 2) {
        const c1 = holeCards[0];
        const c2 = holeCards[1];
        const isPair = c1.value === c2.value;
        const isSuited = c1.suit === c2.suit;
        const gap = Math.abs(c1.value - c2.value);
        const highVal = Math.max(c1.value, c2.value);
        const lowVal = Math.min(c1.value, c2.value);

        if (isPair) {
            if (highVal >= 11) description = "Premium Pocket Pair"; // JJ+
            else if (highVal >= 8) description = "Medium Pocket Pair"; // 88-TT
            else description = "Small Pocket Pair";
        } else if (highVal >= 13 && lowVal >= 10) {
            description = "Premium High Cards"; // AK, AQ, KQ, KJ, QJ...
        } else if (isSuited && gap === 1) {
            description = "Suited Connectors";
        } else if (isSuited && highVal === 14) {
            description = "Suited Ace";
        } else if (highVal >= 10 && lowVal >= 10) {
            description = "Broadways";
        } else {
            description = "Trash / Weak";
        }
        
        return {
            description,
            draws: [],
            outs: 0,
            rankName: "High Card",
            rankValue: 0
        };
    }

    // Postflop Analysis
    
    // 1. Flush Draw
    const suits: Record<string, number> = {};
    allCards.forEach(c => suits[c.suit] = (suits[c.suit] || 0) + 1);
    const hasFlushDraw = Object.values(suits).some(count => count === 4);
    if (hasFlushDraw) {
        draws.push("Flush Draw");
        outs += 9;
    }

    // 2. Straight Draw
    const values = Array.from(new Set(allCards.map(c => c.value))).sort((a, b) => a - b);
    if (values.includes(14)) values.unshift(1); // Handle Ace low
    
    // Check for 4 cards within a window of 5
    let isOESD = false;
    for (let i = 0; i <= values.length - 4; i++) {
        const window = values.slice(i, i + 4);
        const range = window[window.length - 1] - window[0];
        
        // If range is <= 4, it's at least a gutshot (e.g., 5,6,8,9 is range 4)
        if (range <= 4) {
             // OESD check: Consecutive 4 cards (range 3) that are not blocked?
             // Simplification: Range 3 is OESD (e.g. 5,6,7,8)
             if (range === 3) {
                 if (!isOESD) {
                     draws.push("Open-Ended Straight Draw");
                     outs += 8;
                     isOESD = true;
                 }
             } else {
                 if (!draws.includes("Gutshot Straight Draw") && !isOESD) {
                     draws.push("Gutshot Straight Draw");
                     outs += 4;
                 }
             }
        }
    }

    // Adjust Outs for overlap (simplified)
    if (hasFlushDraw && (draws.includes("Open-Ended Straight Draw") || draws.includes("Gutshot Straight Draw"))) {
        outs -= 2; 
    }

    // Refine Description for Pairs
    if (handRank.rank === 1) {
        const boardHigh = Math.max(...communityCards.map(c => c.value), 0);
        const counts: Record<number, number> = {};
        allCards.forEach(c => counts[c.value] = (counts[c.value] || 0) + 1);
        const pairValue = parseInt(Object.keys(counts).find(k => counts[parseInt(k)] === 2) || "0");
        
        if (pairValue >= boardHigh) description = "Top Pair";
        else if (pairValue > Math.min(...communityCards.map(c => c.value))) description = "Middle Pair";
        else description = "Bottom Pair";
    }

    return {
        description: description,
        draws: draws,
        outs: outs,
        rankName: handRank.name,
        rankValue: handRank.rank
    };
};