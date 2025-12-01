import React from 'react';
import { Card as CardType } from '../types';

interface CardProps {
  card?: CardType;
  hidden?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const suitSymbols = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const suitColors = {
  hearts: 'text-red-500',
  diamonds: 'text-red-500',
  clubs: 'text-slate-800',
  spades: 'text-slate-800',
};

export const CardComponent: React.FC<CardProps> = ({ card, hidden, className = '', size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-8 h-12 text-xs',
    md: 'w-12 h-16 text-sm',
    lg: 'w-16 h-24 text-lg',
  };

  if (hidden || !card) {
    return (
      <div
        className={`${sizeClasses[size]} ${className} bg-blue-800 border-2 border-white rounded shadow-md flex items-center justify-center bg-opacity-90`}
      >
        <div className="w-full h-full bg-[url('https://www.transparenttextures.com/patterns/diagmonds-light.png')] opacity-20"></div>
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} ${className} bg-white rounded shadow-md flex flex-col items-center justify-center relative select-none`}
    >
      <span className={`absolute top-0.5 left-1 font-bold ${suitColors[card.suit]}`}>
        {card.rank}
      </span>
      <span className={`text-2xl ${suitColors[card.suit]}`}>
        {suitSymbols[card.suit]}
      </span>
      <span className={`absolute bottom-0.5 right-1 font-bold ${suitColors[card.suit]} rotate-180`}>
        {card.rank}
      </span>
    </div>
  );
};
