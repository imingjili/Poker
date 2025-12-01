export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number; // 2-14
}

export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'bust' | 'spectator';

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  chips: number;
  hand: Card[];
  currentBet: number; // Amount bet in the current street
  status: PlayerStatus;
  lastAction?: string;
  totalInvested: number; // Total invested in the current hand
}

export type GameStage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'gameOver';

export interface GameState {
  players: Player[];
  pot: number;
  communityCards: Card[];
  deck: Card[];
  dealerIndex: number;
  currentPlayerIndex: number;
  currentBet: number; // The amount to call
  minRaise: number;
  lastAggressorIndex: number | null; // Tracks who made the last aggressive action (raise)
  stage: GameStage;
  winners: { ids: number[]; description: string; amount: number }[];
  logs: string[];
  isThinking: boolean; // AI thinking state
  gameMode: 'online' | 'offline'; // New toggle for bot type
}

export interface HandRank {
  rank: number; // 0-8 (High Card to Straight Flush)
  name: string;
  score: number; // Tie-breaker score
}