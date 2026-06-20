import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameController } from '../../src/controllers/game';
import { GameService } from '../../src/services/game';
import { LLMService } from '../../src/services/llm';
import { StorageService } from '../../src/services/storage';

describe('GameController', () => {
  let controller: GameController;
  let gameService: GameService;
  let llmService: LLMService;
  let storageService: StorageService;

  beforeEach(() => {
    gameService = vi.mocked({
      validateMove: vi.fn(),
      makeMove: vi.fn(),
      getGameState: vi.fn(),
    });
    llmService = vi.mocked({
      getOpponentMove: vi.fn(),
    });
    storageService = vi.mocked({
      saveGame: vi.fn(),
      loadGame: vi.fn(),
    });

    controller = new GameController(gameService, llmService, storageService);
  });

  it('should handle a valid user move and trigger opponent turn', async () => {
    vi.mocked(gameService.validateMove).mockResolvedValue(true);
    vi.mocked(gameService.makeMove).mockResolvedValue(undefined);
    vi.mocked(llmService.getOpponentMove).mockResolvedValue({ row: 1, col: 1 });
    vi.mocked(gameService.makeMove).mockResolvedValueOnce(undefined);
    vi.mocked(gameService.getGameState).mockResolvedValue({
      board: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      currentPlayer: 'user',
      winner: null,
    });

    await controller.handleUserMove(0, 0);

    expect(gameService.validateMove).toHaveBeenCalledWith(0, 0);
    expect(gameService.makeMove).toHaveBeenCalledWith(0, 0, 'user');
    expect(llmService.getOpponentMove).toHaveBeenCalled();
