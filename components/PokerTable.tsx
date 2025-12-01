import React from 'react';
import { Player, Card, GameState } from '../types';
import { CardComponent } from './Card';

interface PokerTableProps {
  gameState: GameState;
  userIndex: number; // To orient the table so user is at bottom
}

const getPositionStyle = (index: number, totalPlayers: number) => {
  // Elliptical distribution
  const angle = (index / totalPlayers) * 2 * Math.PI + Math.PI / 2; // Start from bottom (user)
  const xRadius = 42; // %
  const yRadius = 35; // %
  const left = 50 + xRadius * Math.cos(angle);
  const top = 46 + yRadius * Math.sin(angle);
  return { left: `${left}%`, top: `${top}%` };
};

export const PokerTable: React.FC<PokerTableProps> = ({ gameState, userIndex }) => {
  // Rotate players array so user is always at index 0 visually
  const rotatedPlayers = [
    ...gameState.players.slice(userIndex),
    ...gameState.players.slice(0, userIndex),
  ];

  return (
    <div className="relative w-full max-w-4xl aspect-[16/9] mx-auto bg-slate-900 flex items-center justify-center">
      {/* Table Felt */}
      <div className="relative w-[80%] h-[60%] bg-green-700 rounded-[100px] border-[12px] border-green-900 shadow-2xl flex items-center justify-center">
        
        {/* Pot Info */}
        <div className="flex flex-col items-center justify-center space-y-2 mb-8">
            <div className="bg-black/40 px-4 py-1 rounded-full text-green-300 font-mono text-xl border border-green-500/30">
                Pot: ${gameState.pot}
            </div>
            
            {/* Community Cards */}
            <div className="flex space-x-2 h-24 items-center">
                {gameState.communityCards.map((card, idx) => (
                    <CardComponent key={idx} card={card} size="lg" />
                ))}
                {Array(5 - gameState.communityCards.length).fill(0).map((_, i) => (
                     <div key={`ph-${i}`} className="w-16 h-24 border-2 border-white/10 rounded border-dashed" />
                ))}
            </div>
            
            {gameState.winners.length > 0 && (
                <div className="absolute z-50 top-1/2 -translate-y-1/2 bg-yellow-500 text-black px-6 py-3 rounded-lg shadow-xl font-bold animate-bounce text-center">
                    {gameState.winners.map((w, i) => (
                        <div key={i}>{w.description} wins ${w.amount}!</div>
                    ))}
                </div>
            )}
        </div>

      </div>

      {/* Players */}
      {rotatedPlayers.map((player, i) => {
        // Map visual index back to actual player ID to find real index for highlighting
        const actualIndex = (userIndex + i) % 8;
        const isActive = gameState.currentPlayerIndex === actualIndex && gameState.winners.length === 0;
        const isWinner = gameState.winners.some(w => w.ids.includes(player.id));
        const style = getPositionStyle(i, 8);

        return (
          <div
            key={player.id}
            className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300
                flex flex-col items-center w-32
            `}
            style={style}
          >
            {/* Cards */}
            <div className="flex -space-x-4 mb-1 relative">
               {player.status !== 'spectator' && player.status !== 'bust' && (
                 <>
                   <CardComponent card={player.hand[0]} hidden={!player.isHuman && gameState.stage !== 'showdown' && !isWinner} size="sm" />
                   <CardComponent card={player.hand[1]} hidden={!player.isHuman && gameState.stage !== 'showdown' && !isWinner} size="sm" className="origin-bottom-left rotate-6 translate-y-1" />
                 </>
               )}
            </div>

            {/* Avatar Bubble */}
            <div 
                className={`
                    relative w-20 h-20 rounded-full border-4 flex flex-col items-center justify-center bg-gray-800 shadow-lg
                    ${isActive ? 'border-yellow-400 ring-4 ring-yellow-400/30 shadow-[0_0_20px_rgba(250,204,21,0.5)]' : 'border-gray-600'}
                    ${player.status === 'folded' ? 'opacity-50 grayscale' : ''}
                    ${isWinner ? 'border-green-400 ring-4 ring-green-400/50 scale-110 bg-green-900' : ''}
                `}
            >
                {/* Dealer Button */}
                {gameState.dealerIndex === actualIndex && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-white text-black rounded-full flex items-center justify-center font-bold text-xs border border-gray-400 shadow">D</div>
                )}
                
                <div className="font-bold text-xs text-white truncate w-16 text-center">{player.name}</div>
                <div className="text-green-400 font-mono text-sm">${player.chips}</div>
                
                {player.lastAction && (
                    <div className="absolute -bottom-6 bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap z-10 animate-fade-in-up">
                        {player.lastAction}
                    </div>
                )}
                
                {/* Current Bet Bubble */}
                {player.currentBet > 0 && (
                    <div className="absolute -right-10 top-1/2 -translate-y-1/2 flex items-center">
                        <div className="w-4 h-4 bg-yellow-500 rounded-full mr-1 shadow"></div>
                        <span className="text-yellow-400 font-bold text-sm shadow-black drop-shadow-md">${player.currentBet}</span>
                    </div>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
