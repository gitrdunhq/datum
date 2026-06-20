import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService } from '../../src/services/storage';

describe('StorageService', () => {
  let storageService: StorageService;

  beforeEach(() => {
    storageService = new StorageService();
    // Clear storage before each test to ensure isolation
    localStorage.clear();
  });

  it('should save the board configuration to local storage', () => {
    const board = [
      ['X', 'O', 'X'],
      ['O', 'X', 'O'],
      ['X', 'O', 'X']
    ];
    storageService.saveBoard(board);
    const savedBoard = localStorage.getItem('ticTacToe_board');
    expect(savedBoard).toBe(JSON.stringify(board));
  });

  it('should restore the board configuration from local storage', () => {
    const board = [
      ['X', 'O', 'X'],
      ['O', 'X', 'O'],
      ['X', 'O', 'X']
    ];
    localStorage.setItem('ticTacToe_board', JSON.stringify(board));
    const restoredBoard = storageService.restoreBoard();
    expect(restoredBoard).toEqual(board);
  });

  it('should save the current turn to local storage', () => {
    storageService.saveTurn('X');
    const savedTurn = localStorage.getItem('ticTacToe_turn');
    expect(savedTurn).toBe('X');
  });

  it('should restore the current turn from local storage', () => {
    localStorage.setItem('ticTacToe_turn', 'O');
    const restoredTurn = storageService.restoreTurn();
    expect(restoredTurn).toBe('O');
  });
