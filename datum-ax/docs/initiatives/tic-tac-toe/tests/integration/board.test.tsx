import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Board from '../../src/components/Board';

describe('Board Integration', () => {
  it('renders the 3x3 grid with 9 squares', () => {
    render(<Board />);
    const squares = screen.getAllByRole('button');
    expect(squares).toHaveLength(9);
  });

  it('displays the current player turn', () => {
    render(<Board />);
    expect(screen.getByText(/Current Turn: X/i)).toBeInTheDocument();
  });

  it('updates the turn display after a square is clicked', () => {
    render(<Board />);
    const firstSquare = screen.getAllByRole('button')[0];
    fireEvent.click(firstSquare);
    expect(screen.getByText(/Current Turn: O/i)).toBeInTheDocument();
  });

  it('displays a winner message when a player wins', () => {
    render(<Board />);
    // Simulate a win for X: top row
    const squares = screen.getAllByRole('button');
    fireEvent.click(squares[0]); // X
    fireEvent.click(squares[1]); // O
    fireEvent.click(squares[3]); // X
    fireEvent.click(squares[4]); // O
    fireEvent.click(squares[6]); // X
    fireEvent.click(squares[7]); // O
    fireEvent.click(squares[8]); // X
    
    expect(screen.getByText(/X Wins!/i)).toBeInTheDocument();
  });

  it('displays a draw message when the board is full', () => {
    render(<Board />);
    const squares = screen.getAllByRole('button');
    
    // Fill the board without a winner
    squares.forEach((square, index) => {
      if (index % 2 === 0) {
