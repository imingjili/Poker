import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Player, GameState, Card, GameStage, PlayerStatus } from './types';
import { createDeck, shuffleDeck, evaluateHand } from './utils/pokerLogic';
import { PokerTable } from './components/PokerTable';
import { getAIDecision } from './services/geminiService';

// --- Constants ---
const STARTING_CHIPS = 1000;
const SB_AMOUNT = 5;
const BB_AMOUNT = 10;
const INITIAL_PLAYERS: Player[] = Array(8).fill(0).map((_, i) => ({
  id: i,
  name: i === 0 ? "You" : `Bot ${i}`,
  isHuman: i === 0,
  chips: STARTING_CHIPS,
  hand: [],
  currentBet: 0,
  status: 'active',
  totalInvested: 0
}));

const App: React.FC = () => {
  // --- State ---
  const [gameState, setGameState] = useState<GameState>({
    players: INITIAL_PLAYERS,
    pot: 0,
    communityCards: [],
    deck: [],
    dealerIndex: 0,
    currentPlayerIndex: -1, // -1 means game not started or between states
    currentBet: 0,
    minRaise: BB_AMOUNT,
    lastAggressorIndex: null,
    stage: 'gameOver',
    winners: [],
    logs: ['Welcome to GTO Poker Night!'],
    isThinking: false,
    gameMode: process.env.API_KEY ? 'online' : 'offline'
  });

  const [raiseAmount, setRaiseAmount] = useState<number>(BB_AMOUNT * 2);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll logs
  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [gameState.logs]);

  // --- Helpers ---
  const log = (msg: string) => {
    setGameState(prev => ({ ...prev, logs: [...prev.logs, msg] }));
  };

  const getActivePlayers = (players: Player[]) => players.filter(p => p.status !== 'spectator' && p.status !== 'bust');
  
  // --- Game Loop Actions ---

  const startNewHand = useCallback(() => {
    setGameState(prev => {
      // 1. Kick busted players
      const cleanedPlayers = prev.players.map(p => {
        if (p.chips === 0 && p.status !== 'spectator') return { ...p, status: 'spectator' as PlayerStatus };
        if (p.status === 'bust') return { ...p, status: 'spectator' as PlayerStatus };
        return { ...p, status: 'active' as PlayerStatus, currentBet: 0, totalInvested: 0, hand: [], lastAction: undefined };
      });
      
      // If human is busted, reset game entirely
      if (cleanedPlayers[0].status === 'spectator') {
        alert("You went bankrupt! Game over. Restarting...");
        window.location.reload();
        return prev;
      }
      
      const activeCount = cleanedPlayers.filter(p => p.status === 'active').length;
      if (activeCount < 2) {
        alert("You won the tournament!");
        window.location.reload();
        return prev;
      }

      // 2. Rotate Dealer
      let nextDealer = (prev.dealerIndex + 1) % 8;
      while(cleanedPlayers[nextDealer].status === 'spectator') {
        nextDealer = (nextDealer + 1) % 8;
      }

      // 3. Deck & Deal
      const deck = shuffleDeck(createDeck());
      const activeIndices = cleanedPlayers.map((p, i) => i).filter(i => cleanedPlayers[i].status === 'active');
      
      activeIndices.forEach(i => {
        cleanedPlayers[i].hand = [deck.pop()!, deck.pop()!];
      });

      // 4. Blinds
      // Find SB
      let sbIndex = (nextDealer + 1) % 8;
      while(cleanedPlayers[sbIndex].status === 'spectator') sbIndex = (sbIndex + 1) % 8;
      
      // Find BB
      let bbIndex = (sbIndex + 1) % 8;
      while(cleanedPlayers[bbIndex].status === 'spectator') bbIndex = (bbIndex + 1) % 8;
      
      // Find UTG (First Action)
      let utgIndex = (bbIndex + 1) % 8;
      while(cleanedPlayers[utgIndex].status === 'spectator') utgIndex = (utgIndex + 1) % 8;
      // Head-up adjustment: dealer is SB
      if (activeCount === 2) {
          sbIndex = nextDealer;
          bbIndex = (nextDealer + 1) % 8;
          utgIndex = nextDealer; // SB acts first preflop in heads up
      }

      // Post Blinds
      const sbPlayer = cleanedPlayers[sbIndex];
      const bbPlayer = cleanedPlayers[bbIndex];
      
      const sbPosted = Math.min(sbPlayer.chips, SB_AMOUNT);
      sbPlayer.chips -= sbPosted;
      sbPlayer.currentBet = sbPosted;
      sbPlayer.totalInvested = sbPosted;
      if (sbPlayer.chips === 0) sbPlayer.status = 'all-in';
      
      const bbPosted = Math.min(bbPlayer.chips, BB_AMOUNT);
      bbPlayer.chips -= bbPosted;
      bbPlayer.currentBet = bbPosted;
      bbPlayer.totalInvested = bbPosted;
      if (bbPlayer.chips === 0) bbPlayer.status = 'all-in';

      return {
        ...prev,
        players: cleanedPlayers,
        deck,
        communityCards: [],
        pot: sbPosted + bbPosted,
        currentBet: BB_AMOUNT,
        minRaise: BB_AMOUNT, // Raise must be at least BB
        dealerIndex: nextDealer,
        currentPlayerIndex: utgIndex,
        stage: 'preflop',
        lastAggressorIndex: null, // Reset aggression for new hand
        winners: [],
        logs: [`New Hand. Blinds: ${sbPosted}/${bbPosted}. Mode: ${prev.gameMode.toUpperCase()}`],
        isThinking: false
      };
    });
  }, []);


  const handleAction = async (action: 'check' | 'call' | 'fold' | 'raise', amount?: number) => {
    setGameState(prev => {
      const player = prev.players[prev.currentPlayerIndex];
      let newPlayers = [...prev.players];
      let newPot = prev.pot;
      let newCurrentBet = prev.currentBet;
      let newMinRaise = prev.minRaise;
      let newLastAggressor = prev.lastAggressorIndex;
      let logMsg = `${player.name} `;
      
      const toCall = prev.currentBet - player.currentBet;
      let safeAction = action;

      // --- CRITICAL RULE ENFORCEMENT ---
      // If player tries to Check but there is a bet, force FOLD (unless all-in situations which logic below handles generally)
      if (safeAction === 'check' && toCall > 0) {
          console.error(`CRITICAL: ${player.name} attempted illegal CHECK. Forcing FOLD.`);
          safeAction = 'fold'; // Safer to fold than call and lose chips unexpectedly
      }

      if (safeAction === 'fold') {
        newPlayers[prev.currentPlayerIndex] = { ...player, status: 'folded', lastAction: 'Fold' };
        logMsg += 'folds.';
      } else if (safeAction === 'check') {
        newPlayers[prev.currentPlayerIndex] = { ...player, lastAction: 'Check' };
        logMsg += 'checks.';
      } else if (safeAction === 'call') {
        const actualCall = Math.min(toCall, player.chips);
        newPlayers[prev.currentPlayerIndex] = { 
            ...player, 
            chips: player.chips - actualCall, 
            currentBet: player.currentBet + actualCall,
            totalInvested: player.totalInvested + actualCall,
            lastAction: 'Call'
        };
        if (newPlayers[prev.currentPlayerIndex].chips === 0) newPlayers[prev.currentPlayerIndex].status = 'all-in';
        newPot += actualCall;
        logMsg += `calls $${actualCall}.`;
      } else if (safeAction === 'raise') {
        // amount input is total bet amount for the round
        const totalBet = amount || (prev.currentBet + prev.minRaise);
        const addedToPot = totalBet - player.currentBet;
        const actualAdded = Math.min(addedToPot, player.chips);
        
        // Calculate the actual total bet after capped by chips
        const finalTotalBet = player.currentBet + actualAdded;
        
        // Is this a valid raise? Update min raise if it's a full raise
        const raiseDiff = finalTotalBet - prev.currentBet;
        if (raiseDiff >= prev.minRaise) {
            newMinRaise = raiseDiff;
        }

        newPlayers[prev.currentPlayerIndex] = {
            ...player,
            chips: player.chips - actualAdded,
            currentBet: finalTotalBet,
            totalInvested: player.totalInvested + actualAdded,
            lastAction: `Raise ${finalTotalBet}`
        };
        if (newPlayers[prev.currentPlayerIndex].chips === 0) newPlayers[prev.currentPlayerIndex].status = 'all-in';
        newPot += actualAdded;
        newCurrentBet = Math.max(newCurrentBet, finalTotalBet);
        newLastAggressor = player.id; // UPDATE AGGRESSOR
        logMsg += `raises to ${finalTotalBet}.`;
      }

      return {
        ...prev,
        players: newPlayers,
        pot: newPot,
        currentBet: newCurrentBet,
        minRaise: newMinRaise,
        lastAggressorIndex: newLastAggressor,
        logs: [...prev.logs, logMsg]
      };
    });
    
    // Slight delay before next turn calculation to allow UI update
    setTimeout(() => advanceTurn(), 500);
  };

  const advanceTurn = () => {
    setGameState(prev => {
        const activePlayers = prev.players.filter(p => p.status === 'active');
        const allInPlayers = prev.players.filter(p => p.status === 'all-in');
        const notFolded = [...activePlayers, ...allInPlayers];

        if (notFolded.length === 1) {
            // Everyone folded
            return determineWinner({...prev}, true);
        }

        // Find next active player
        let nextIndex = (prev.currentPlayerIndex + 1) % 8;
        let loopCount = 0;
        
        while (prev.players[nextIndex].status !== 'active' && loopCount < 8) {
            nextIndex = (nextIndex + 1) % 8;
            loopCount++;
        }
        
        if (loopCount === 8 || activePlayers.length === 0) {
            return nextStreet(prev);
        }

        const nextPlayer = prev.players[nextIndex];
        
        const allMatched = activePlayers.every(p => p.currentBet === prev.currentBet);
        const everyoneActed = activePlayers.every(p => p.lastAction !== undefined);

        if (allMatched && everyoneActed) {
             return nextStreet(prev);
        }
        
        return { ...prev, currentPlayerIndex: nextIndex };
    });
  };

  const nextStreet = (state: GameState): GameState => {
    const { stage, deck, communityCards } = state;
    
    // Reset bets for new street
    const playersReset = state.players.map(p => ({ 
        ...p, 
        currentBet: 0, 
        lastAction: p.status === 'active' ? undefined : p.lastAction 
    }));

    let nextStage: GameStage = stage;
    let nextCommunity = [...communityCards];
    
    if (stage === 'preflop') {
        nextStage = 'flop';
        deck.pop(); // Burn
        nextCommunity.push(deck.pop()!, deck.pop()!, deck.pop()!);
    } else if (stage === 'flop') {
        nextStage = 'turn';
        deck.pop(); // Burn
        nextCommunity.push(deck.pop()!);
    } else if (stage === 'turn') {
        nextStage = 'river';
        deck.pop(); // Burn
        nextCommunity.push(deck.pop()!);
    } else if (stage === 'river') {
        return determineWinner({ ...state, players: playersReset, stage: 'showdown' });
    }

    // Determine who starts next round (First active player after dealer)
    let firstActor = (state.dealerIndex + 1) % 8;
    while(playersReset[firstActor].status !== 'active') {
        firstActor = (firstActor + 1) % 8;
        const activeCount = playersReset.filter(p => p.status === 'active').length;
        if (activeCount < 2) break;
    }
    
    return {
        ...state,
        players: playersReset,
        stage: nextStage,
        communityCards: nextCommunity,
        currentPlayerIndex: firstActor,
        currentBet: 0,
        minRaise: BB_AMOUNT,
        // We DO NOT reset lastAggressorIndex here. The aggressor retains initiative until raised.
        logs: [...state.logs, `--- ${nextStage.toUpperCase()} ---`]
    };
  };

  const determineWinner = (state: GameState, byFold = false): GameState => {
    let winners: { ids: number[]; description: string; amount: number }[] = [];
    const notFolded = state.players.filter(p => p.status !== 'folded' && p.status !== 'spectator' && p.status !== 'bust');

    if (byFold || notFolded.length === 1) {
        winners = [{ ids: [notFolded[0].id], description: `${notFolded[0].name} wins by fold`, amount: state.pot }];
    } else {
        // Evaluate hands
        const scoredPlayers = notFolded.map(p => ({
            id: p.id,
            name: p.name,
            handRank: evaluateHand(p.hand, state.communityCards)
        }));
        
        scoredPlayers.sort((a, b) => b.handRank.score - a.handRank.score);
        
        const bestScore = scoredPlayers[0].handRank.score;
        const tyingWinners = scoredPlayers.filter(p => p.handRank.score === bestScore);
        
        // Split pot
        const winAmount = Math.floor(state.pot / tyingWinners.length);
        winners = [{
            ids: tyingWinners.map(w => w.id),
            description: `${tyingWinners.map(w => w.name).join(', ')} with ${tyingWinners[0].handRank.name}`,
            amount: winAmount
        }];
    }

    // Distribute Chips
    const updatedPlayers = state.players.map(p => {
        const winInfo = winners.find(w => w.ids.includes(p.id));
        if (winInfo) {
            return { ...p, chips: p.chips + winInfo.amount };
        }
        return p;
    });

    return {
        ...state,
        players: updatedPlayers,
        stage: 'gameOver',
        winners,
        pot: 0,
        logs: [...state.logs, `Winner: ${winners[0].description}`]
    };
  };

  // --- AI Effect ---
  useEffect(() => {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (
        gameState.stage !== 'gameOver' && 
        gameState.stage !== 'showdown' &&
        currentPlayer && 
        !currentPlayer.isHuman && 
        currentPlayer.status === 'active' &&
        !gameState.isThinking
    ) {
        setGameState(prev => ({...prev, isThinking: true}));
        
        // Calculate valid actions
        const toCall = gameState.currentBet - currentPlayer.currentBet;
        const canCheck = toCall === 0;
        const canRaise = currentPlayer.chips > toCall;
        
        const validActions = ['fold'];
        if (canCheck) validActions.push('check');
        else validActions.push('call');
        if (canRaise) validActions.push('raise');

        // Delay for realism (faster in offline mode)
        const delay = gameState.gameMode === 'offline' ? 800 : 1500;
        
        setTimeout(async () => {
            const decision = await getAIDecision(currentPlayer, gameState, validActions, gameState.minRaise);
            setGameState(prev => ({...prev, isThinking: false}));
            handleAction(decision.action, decision.amount);
        }, delay);
    } else if (
        gameState.stage !== 'gameOver' && 
        gameState.stage !== 'showdown' &&
        gameState.players.filter(p => p.status === 'active').length === 0
    ) {
        // Everyone all in? Advance automatically
         setTimeout(() => advanceTurn(), 1000);
    }
  }, [gameState.currentPlayerIndex, gameState.stage, gameState.currentBet]); 

  // --- UI Components ---

  const user = gameState.players[0];
  const isUserTurn = gameState.currentPlayerIndex === 0 && gameState.stage !== 'gameOver';
  const toCall = gameState.currentBet - user.currentBet;

  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans selection:bg-green-500 selection:text-white">
      {/* Header */}
      <div className="absolute top-4 left-4 z-10 flex flex-col items-start">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-blue-500">
            GTO Poker Night
        </h1>
        <div className="flex items-center space-x-2 mt-1">
             <span className="text-xs text-slate-400">Mode:</span>
             <button 
                onClick={() => setGameState(p => ({...p, gameMode: p.gameMode === 'online' ? 'offline' : 'online'}))}
                className={`text-xs px-2 py-0.5 rounded font-bold border transition-colors ${gameState.gameMode === 'online' ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-700 border-slate-500 text-slate-300'}`}
             >
                {gameState.gameMode === 'online' ? 'GEMINI AI' : 'OFFLINE BOT'}
             </button>
        </div>
      </div>

      {/* Main Table Area */}
      <div className="pt-12 pb-32">
        <PokerTable gameState={gameState} userIndex={0} />
      </div>

      {/* Controls Bar */}
      <div className="fixed bottom-0 left-0 w-full bg-slate-800 border-t border-slate-700 shadow-2xl p-4 z-50">
        <div className="max-w-5xl mx-auto flex justify-between items-end">
            
            {/* Log Panel */}
            <div className="w-1/3 h-32 bg-black/50 rounded-lg p-2 overflow-y-auto scrollbar-hide text-xs font-mono text-green-300 border border-slate-600" ref={scrollRef}>
                {gameState.logs.map((l, i) => (
                    <div key={i} className="mb-1 border-b border-white/5 pb-0.5">{l}</div>
                ))}
            </div>

            {/* Action Buttons */}
            <div className="flex-1 flex flex-col items-center justify-end ml-4 space-y-4">
                
                {gameState.stage === 'gameOver' ? (
                     <button 
                        onClick={startNewHand}
                        className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-full shadow-lg transform hover:scale-105 transition-all text-xl"
                    >
                        {gameState.players.filter(p => p.status !== 'spectator').length < 2 ? "Start Tournament" : "Next Hand"}
                    </button>
                ) : (
                    <>
                        {/* Raise Slider */}
                        {isUserTurn && user.chips > toCall && (
                             <div className="w-full max-w-md bg-slate-700 p-2 rounded-lg flex items-center space-x-4">
                                <span className="text-xs font-bold text-slate-300">RAISE TO:</span>
                                <input 
                                    type="range" 
                                    min={gameState.currentBet + gameState.minRaise} 
                                    max={user.chips + user.currentBet} 
                                    step={gameState.minRaise}
                                    value={Math.max(gameState.currentBet + gameState.minRaise, raiseAmount)}
                                    onChange={(e) => setRaiseAmount(parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-green-500"
                                />
                                <span className="font-mono font-bold w-16 text-right">${Math.max(gameState.currentBet + gameState.minRaise, raiseAmount)}</span>
                             </div>
                        )}

                        <div className="flex space-x-4">
                            <button
                                disabled={!isUserTurn}
                                onClick={() => handleAction('fold')}
                                className="w-24 py-3 bg-red-600 rounded-lg font-bold shadow-lg disabled:opacity-20 disabled:scale-95 transition-all hover:bg-red-500 border-b-4 border-red-800 active:border-b-0 active:translate-y-1"
                            >
                                FOLD
                            </button>
                            
                            <button
                                disabled={!isUserTurn}
                                onClick={() => handleAction(toCall === 0 ? 'check' : 'call')}
                                className="w-24 py-3 bg-blue-600 rounded-lg font-bold shadow-lg disabled:opacity-20 disabled:scale-95 transition-all hover:bg-blue-500 border-b-4 border-blue-800 active:border-b-0 active:translate-y-1"
                            >
                                {toCall === 0 ? 'CHECK' : `CALL $${toCall}`}
                            </button>

                            {user.chips > toCall && (
                                <button
                                    disabled={!isUserTurn}
                                    onClick={() => handleAction('raise', Math.max(gameState.currentBet + gameState.minRaise, raiseAmount))}
                                    className="w-24 py-3 bg-yellow-600 rounded-lg font-bold shadow-lg disabled:opacity-20 disabled:scale-95 transition-all hover:bg-yellow-500 border-b-4 border-yellow-800 active:border-b-0 active:translate-y-1"
                                >
                                    RAISE
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
            
            {/* Status Info */}
            <div className="w-48 text-right flex flex-col items-end">
                <div className="text-sm text-slate-400">Your Stack</div>
                <div className="text-2xl font-bold text-green-400 font-mono">${user.chips}</div>
                {gameState.isThinking && (
                     <div className="mt-2 text-xs text-yellow-400 animate-pulse flex items-center">
                        <span className="w-2 h-2 bg-yellow-400 rounded-full mr-2"></span> {gameState.gameMode === 'online' ? 'AI Thinking...' : 'Bot Thinking...'}
                     </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;